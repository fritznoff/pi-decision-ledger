import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importDurableAdr, updateDurableAdr } from "../src/durable.ts";
import { replayLedgerBranch, type DecisionRecord, type LedgerState } from "../src/ledger.ts";
import {
	acceptPromotedDecision,
	editPromotedDecision,
	collectPromotionSources,
	findDurablePromotion,
	promoteReviewedBody,
	promotionRelativePath,
	promotionReviewBody,
	renderPromotionBody,
} from "../src/promotion.ts";

const SYNTHESIZED = "# Use SQLite with Atlas for local persistence\n\n## Context and Problem Statement\n\nStorage and migrations must form one coherent local-first persistence approach.\n\n## Considered Options\n\n- SQLite with Atlas\n\n## Decision Outcome\n\nUse SQLite, migrated with Atlas, because it preserves local operation.\n\n### Consequences\n\n- Good, because persistence stays local.\n- Bad, because schema changes require migration discipline.\n";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repositoryRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-promotion-"));
	roots.push(root);
	return root;
}

async function decisionFiles(root: string): Promise<string[]> {
	return await readdir(path.join(root, "decisions")).catch(() => []);
}

function record(seed: string): DecisionRecord {
	return {
		decision: `Use ${seed}.`,
		context: `We needed ${seed}.`,
		optionsConsidered: [`${seed} A`, `${seed} B`],
		consequences: `${seed} has trade-offs.`,
		followUps: [`Document ${seed}`],
	};
}

function state(): LedgerState {
	return {
		ledger: {
			items: [
				{ id: "AAA", title: "Storage engine", point: "Which storage engine?", lifecycle: "resolved", record: record("SQLite") },
				{ id: "BBB", title: "Migration tool", point: "Which migration tool?", lifecycle: "proposed", record: record("Atlas") },
				{ id: "CCC", title: "Cache layer", point: "Which cache layer?", lifecycle: "open" },
				{ id: "DDD", title: "Log format", point: "Which log format?", lifecycle: "deferred" },
				{ id: "EEE", title: "Metrics sink", point: "Which metrics sink?", lifecycle: "ignored" },
			],
		},
	};
}

describe("explicit source sets", () => {
	it("preserves the caller's explicit order and freezes the source content", () => {
		const sources = collectPromotionSources(state(), ["bbb", "AAA"]);
		expect(sources.map((source) => source.id)).toEqual(["BBB", "AAA"]);
		expect(Object.isFrozen(sources)).toBe(true);
		expect(sources[0]!.record).toEqual(record("Atlas"));
		expect(Object.isFrozen(sources[0])).toBe(true);
		expect(Object.isFrozen(sources[0]!.record)).toBe(true);
		expect(Object.isFrozen(sources[0]!.record!.optionsConsidered)).toBe(true);
		const mutated = state();
		const collected = collectPromotionSources(mutated, ["AAA"]);
		mutated.ledger!.items[0]!.record!.decision = "changed";
		expect(collected[0]!.record!.decision).toBe("Use SQLite.");
	});

	it("promotes only open, proposed, and resolved decisions", () => {
		expect(() => collectPromotionSources(state(), ["CCC"])).not.toThrow();
		expect(() => collectPromotionSources(state(), ["DDD"])).toThrow(/deferred/);
		expect(() => collectPromotionSources(state(), ["EEE"])).toThrow(/ignored/);
	});

	it("rejects empty, duplicate, unknown, and actively explored sources", () => {
		expect(() => collectPromotionSources(state(), [])).toThrow(/at least one/);
		expect(() => collectPromotionSources(state(), ["AAA", "aaa"])).toThrow(/duplicate/);
		expect(() => collectPromotionSources(state(), ["ZZZ"])).toThrow(/unknown decision/);
		const explored = state();
		explored.ledger!.items[1]!.exploration = { returnEntryId: "entry", returnLabel: "label", origin: "open" };
		expect(() => collectPromotionSources(explored, ["BBB"])).toThrow(/actively explored/);
	});

	it("refuses to promote an already promoted decision twice", async () => {
		const root = await repositoryRoot();
		const outcome = await promoteReviewedBody(state(), {
			repositoryRoot: root,
			reviewedBody: renderPromotionBody(collectPromotionSources(state(), ["AAA"])),
			sourceIds: ["AAA"],
		});
		expect(() => collectPromotionSources(outcome.state, ["AAA"])).toThrow(/already promoted/);
	});
});

describe("draft rendering", () => {
	it("maps a single source one-to-one without attribution noise", () => {
		const body = renderPromotionBody(collectPromotionSources(state(), ["AAA"]));
		expect(body).toContain("# Storage engine");
		expect(body).toContain("Which storage engine?");
		expect(body).toContain("Use SQLite.");
		expect(body).not.toContain("`AAA`");
	});

	it("never consolidates several sources mechanically", () => {
		expect(() => renderPromotionBody(collectPromotionSources(state(), ["AAA", "BBB"]))).toThrow(/synthesized candidate/);
		expect(() => promotionReviewBody(state(), ["AAA", "BBB"])).toThrow(/agent.*promote_adr/);
	});

	it("renders an editable skeleton for a source without a record", () => {
		const body = renderPromotionBody(collectPromotionSources(state(), ["CCC"]));
		expect(body).toContain("# Cache layer");
		expect(body).toContain("## Decision Outcome");
	});
});

describe("promotion writes", () => {
	it("writes exactly the reviewed content and digests it", async () => {
		const root = await repositoryRoot();
		const reviewed = renderPromotionBody(collectPromotionSources(state(), ["AAA"]))
			.replace("Use SQLite.", "Use SQLite, reviewed by hand.");
		const outcome = await promoteReviewedBody(state(), { repositoryRoot: root, reviewedBody: reviewed, sourceIds: ["AAA"] });
		const written = await readFile(outcome.absolutePath, "utf8");
		expect(written.endsWith(reviewed)).toBe(true);
		const imported = importDurableAdr(written);
		expect(imported.decision).toBe("Use SQLite, reviewed by hand.");
		expect(imported.lifecycle).toBe("draft");
		expect(imported.semanticDigest).toBe(outcome.adr.semanticDigest);
	});

	it("writes nothing and attaches no identity when the reviewed content is invalid", async () => {
		const root = await repositoryRoot();
		const before = state();
		await expect(promoteReviewedBody(before, {
			repositoryRoot: root,
			reviewedBody: "# Storage engine\n\nNo recognized sections.\n",
			sourceIds: ["AAA"],
		})).rejects.toThrow(/recognized section/);
		expect(await decisionFiles(root)).toEqual([]);
		expect(findDurablePromotion(before, "AAA")).toBeUndefined();
	});

	it("writes nothing when the source set is invalid, even with valid content", async () => {
		const root = await repositoryRoot();
		const reviewed = renderPromotionBody(collectPromotionSources(state(), ["AAA"]));
		await expect(promoteReviewedBody(state(), { repositoryRoot: root, reviewedBody: reviewed, sourceIds: ["EEE"] }))
			.rejects.toThrow(/ignored/);
		expect(await decisionFiles(root)).toEqual([]);
	});

	it("attaches frozen provenance to every source and leaves the input state untouched", async () => {
		const root = await repositoryRoot();
		const before = state();
		const outcome = await promoteReviewedBody(before, {
			repositoryRoot: root,
			reviewedBody: SYNTHESIZED,
			sourceIds: ["AAA", "BBB"],
		});
		expect(findDurablePromotion(before, "AAA")).toBeUndefined();
		for (const id of ["AAA", "BBB"]) {
			const promotion = findDurablePromotion(outcome.state, id)!;
			expect(promotion.adrId).toBe(outcome.adr.id);
			expect(promotion.lifecycle).toBe("draft");
			expect(promotion.sourceDecisionIds).toEqual(["AAA", "BBB"]);
			expect(promotion.repositoryRoot).toBe(await realpath(root));
			expect(promotion.relativePath).toBe(promotionRelativePath(promotion.slug));
		}
		expect(await decisionFiles(root)).toEqual([path.basename(outcome.promotion.relativePath)]);
	});

	it("rejects a registered UUID before creating another file", async () => {
		const root = await repositoryRoot();
		const first = await promoteReviewedBody(state(), { repositoryRoot: root, reviewedBody: SYNTHESIZED, sourceIds: ["AAA"], slug: "first" });
		await expect(promoteReviewedBody(first.state, { repositoryRoot: root, reviewedBody: SYNTHESIZED, sourceIds: ["BBB"], slug: "second", adrId: first.adr.id }))
			.rejects.toThrow(/identity already registered/);
		expect(await decisionFiles(root)).toEqual(["first.md"]);
	});

	it("retains reviewed intent in a stale-source edit conflict", async () => {
		const root = await repositoryRoot();
		const created = await promoteReviewedBody(state(), { repositoryRoot: root, reviewedBody: SYNTHESIZED, sourceIds: ["AAA"] });
		const external = updateDurableAdr(created.adr.source, { decision: "External decision." });
		await writeFile(created.absolutePath, external);
		const result = await editPromotedDecision(created.state, created.promotion.slug, SYNTHESIZED.replace("Use SQLite, migrated with Atlas, because it preserves local operation.", "Reviewed intent must be retained."));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.conflict.proposedSource).toContain("Reviewed intent must be retained.");
		expect(result.conflict.patch).toMatchObject({ decision: "Reviewed intent must be retained." });
		expect(await readFile(created.absolutePath, "utf8")).toBe(external);
	});

	it("never overwrites an existing file at the target path", async () => {
		const root = await repositoryRoot();
		const reviewed = renderPromotionBody(collectPromotionSources(state(), ["AAA"]));
		const outcome = await promoteReviewedBody(state(), { repositoryRoot: root, reviewedBody: reviewed, sourceIds: ["AAA"] });
		await expect(promoteReviewedBody(state(), {
			repositoryRoot: root,
			reviewedBody: reviewed,
			sourceIds: ["AAA"],
			adrId: outcome.adr.id,
		})).rejects.toThrow();
		expect(await readFile(outcome.absolutePath, "utf8")).toBe(outcome.adr.source);
	});
});

describe("acceptance", () => {
	async function promoted(): Promise<{ root: string; state: LedgerState; relativePath: string; slug: string }> {
		const root = await repositoryRoot();
		const outcome = await promoteReviewedBody(state(), {
			repositoryRoot: root,
			reviewedBody: renderPromotionBody(collectPromotionSources(state(), ["AAA"])),
			sourceIds: ["AAA"],
		});
		return { root, state: outcome.state, relativePath: outcome.promotion.relativePath, slug: outcome.promotion.slug };
	}

	it("performs the explicit draft to accepted transition and syncs the working copy", async () => {
		const promotion = await promoted();
		const result = await acceptPromotedDecision(promotion.state, promotion.slug);
		if (!result.ok) throw new Error("acceptance unexpectedly conflicted");
		expect(result.changed).toBe(true);
		expect(result.promotion.lifecycle).toBe("accepted");
		const written = await readFile(path.join(promotion.root, promotion.relativePath), "utf8");
		expect(importDurableAdr(written).lifecycle).toBe("accepted");
		expect(findDurablePromotion(promotion.state, "AAA")!.lifecycle).toBe("draft");
		const again = await acceptPromotedDecision(result.state, promotion.slug);
		if (!again.ok) throw new Error("second acceptance unexpectedly conflicted");
		expect(again.changed).toBe(false);
	});

	it("refuses an authoritative file that changed even if it remains a valid ADR", async () => {
		const promotion = await promoted();
		const absolute = path.join(promotion.root, promotion.relativePath);
		const edited = updateDurableAdr(await readFile(absolute, "utf8"), { decision: "Use Postgres." });
		await writeFile(absolute, edited);
		const result = await acceptPromotedDecision(promotion.state, promotion.slug);
		expect(result).toMatchObject({ ok: false, conflict: { reason: "source-changed" } });
		expect(importDurableAdr(await readFile(absolute, "utf8")).lifecycle).toBe("draft");
	});

	it("preserves promotion provenance through session replay", async () => {
		const promotion = await promoted();
		const replayed = replayLedgerBranch([{
			id: "snapshot",
			type: "custom",
			customType: "pi-decision-ledger",
			data: { extension: "pi-decision-ledger", version: 1, source: "command", state: promotion.state },
		}]);
		expect(findDurablePromotion(replayed, "AAA")).toEqual(findDurablePromotion(promotion.state, "AAA"));
	});

	it("refuses acceptance when the authoritative file no longer verifies", async () => {
		const promotion = await promoted();
		const absolute = path.join(promotion.root, promotion.relativePath);
		const tampered = (await readFile(absolute, "utf8")).replace("Use SQLite.", "Use Postgres.");
		await writeFile(absolute, tampered);
		await expect(acceptPromotedDecision(promotion.state, promotion.slug)).rejects.toThrow(/semantic digest mismatch/);
		expect(await readFile(absolute, "utf8")).toBe(tampered);
		expect(findDurablePromotion(promotion.state, "AAA")!.lifecycle).toBe("draft");
	});

	it("refuses acceptance when the file holds a different ADR", async () => {
		const promotion = await promoted();
		const absolute = path.join(promotion.root, promotion.relativePath);
		const foreign = (await readFile(absolute, "utf8")).replace(/  id: .*/, "  id: 123e4567-e89b-42d3-a456-426614174000");
		await writeFile(absolute, foreign);
		await expect(acceptPromotedDecision(promotion.state, promotion.slug)).rejects.toThrow(/not/);
	});

	it("requires a promoted decision", async () => {
		await expect(acceptPromotedDecision(state(), "missing-adr")).rejects.toThrow(/unknown ADR slug/);
	});
});
