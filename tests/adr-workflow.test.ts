import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import decisionLedgerExtension from "../extensions/index.ts";
import { createDurableAdr, durableAdrBody, importDurableAdr, replaceDurableAdrBody, updateDurableAdr } from "../src/durable.ts";
import { checkoutDurableAdr, deleteDurableDraft, resolveGitRepositoryRoot } from "../src/durable-repository.ts";
import {
	formatDecisionDetail,
	formatDecisionExport,
	formatDecisionOverview,
	replayLedgerBranch,
	removeDecisionItems,
	type DecisionRecord,
	type LedgerState,
} from "../src/ledger.ts";
import {
	acceptPromotedDecision,
	discardPromotedDraft,
	editPromotedDecision,
	findDurablePromotion,
	findRegisteredAdr,
	parsePromoteArguments,
	promoteReviewedBody,
	promotedDraftBody,
	promotionReviewBody,
	reloadPromotedDecision,
} from "../src/promotion.ts";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function tempDir(git = false): Promise<string> {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "pi-adr-workflow-")));
	roots.push(root);
	if (git) await mkdir(path.join(root, ".git"));
	return root;
}

async function adrFiles(root: string): Promise<string[]> {
	return await readdir(path.join(root, "decisions")).catch(() => []);
}

function record(seed: string): DecisionRecord {
	return { decision: `Use ${seed}.`, context: `We needed ${seed}.`, optionsConsidered: [`${seed} A`], consequences: `${seed} trade-offs.`, followUps: [`Document ${seed}`] };
}

function state(): LedgerState {
	return {
		ledger: {
			items: [
				{ id: "AAA", title: "Storage engine", point: "Which storage engine?", lifecycle: "resolved", record: record("SQLite") },
				{ id: "BBB", title: "Migration tool", point: "Which migration tool?", lifecycle: "resolved", record: record("Atlas") },
				{ id: "CCC", title: "Cache layer", point: "Which cache layer?", lifecycle: "open" },
			],
		},
	};
}

const SYNTHESIZED = [
	"# Use SQLite with Atlas for local persistence", "",
	"## Context and Problem Statement", "", "Storage and migrations must form one coherent local-first persistence approach.", "",
	"## Considered Options", "", "- SQLite with Atlas", "- Postgres with Flyway", "",
	"## Decision Outcome", "", "Use SQLite, migrated with Atlas, because it preserves local operation with declarative migrations.", "",
	"### Consequences", "", "- Good, because persistence stays local and portable.", "- Bad, because schema changes require migration discipline.", "",
].join("\n");

function replay(snapshot: LedgerState): LedgerState {
	return replayLedgerBranch([{ id: "s", type: "custom", customType: "pi-decision-ledger", data: { extension: "pi-decision-ledger", version: 1, source: "command", state: snapshot } }]);
}

async function promoted(root?: string): Promise<{ root: string; state: LedgerState; absolute: string; slug: string }> {
	const repository = root ?? await tempDir(true);
	const outcome = await promoteReviewedBody(state(), { repositoryRoot: repository, reviewedBody: SYNTHESIZED, sourceIds: ["AAA", "BBB"] });
	return { root: repository, state: outcome.state, absolute: outcome.absolutePath, slug: outcome.promotion.slug };
}

describe("promoted-state visibility", () => {
	it("shows a durable badge, identity, and path separately from the session lifecycle", async () => {
		const { state: promotedState } = await promoted();
		const promotion = findDurablePromotion(promotedState, "AAA")!;
		const overview = formatDecisionOverview(promotedState);
		expect(overview).toContain("| ID | Lifecycle | ADR | Title |");
		expect(overview).toContain(`| \`AAA\` | resolved | ADR draft \`${promotion.slug}\` | Storage engine |`);
		expect(overview).toContain("| `CCC` | open | — | Cache layer |");
		const detail = formatDecisionDetail(promotedState, "BBB");
		expect(detail).toContain("Lifecycle: **resolved**");
		expect(detail).toContain("ADR lifecycle: **draft**");
		expect(detail).toContain(`ADR slug: \`${promotion.slug}\``);
		expect(detail).toContain(`ADR ID: \`${promotion.adrId}\``);
		expect(detail).toContain(`\`${promotion.relativePath}\` in \`${promotion.repositoryRoot}\``);
		expect(detail).toContain("ADR sources: `AAA`, `BBB`");
		const exported = formatDecisionExport(promotedState);
		expect(exported).toContain("- ADR lifecycle: **draft**");
		expect(exported).toContain(`- ADR ID: \`${promotion.adrId}\``);
	});


	it("marks promoted rows in the interactive selector", async () => {
		const { state: promotedState } = await promoted();
		const fake = fakeExtension(await tempDir());
		await fake.load(promotedState);
		let component: { render: (width: number) => string[] } | undefined;
		fake.context.ui.custom.mockImplementation(async (factory: any) => {
			component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, vi.fn());
			return null;
		});
		await fake.commands.get("decisions")!.handler("", fake.context);
		const rows = component!.render(120).map(stripTerminalSequences);
		expect(rows.find((row) => row.includes("[AAA]"))).toContain("resolved [ADR draft]");
		expect(rows.find((row) => row.includes("[CCC]"))).not.toContain("ADR");
	});

	it("keeps a first-class slug registry after source decisions are removed", async () => {
		const promotion = await promoted();
		const withoutSources = removeDecisionItems(promotion.state, ["AAA", "BBB"]);
		expect(withoutSources.ledger?.items.map((item) => item.id)).toEqual(["CCC"]);
		expect(findRegisteredAdr(withoutSources, promotion.slug)).toMatchObject({ slug: promotion.slug, sourceDecisionIds: ["AAA", "BBB"] });
		const accepted = await acceptPromotedDecision(withoutSources, promotion.slug);
		if (!accepted.ok) throw new Error("acceptance unexpectedly conflicted");
		expect(findRegisteredAdr(accepted.state, promotion.slug)?.lifecycle).toBe("accepted");
	});

	it("lists and completes ADRs by slug and rejects source IDs as handles", async () => {
		const promotion = await promoted();
		const fake = fakeExtension(promotion.root);
		await fake.load(promotion.state);
		await fake.commands.get("adrs")!.handler("", fake.context);
		expect(fake.pi.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining(`\`${promotion.slug}\``) }), { triggerTurn: false });
		const complete = fake.commands.get("adr")!.getArgumentCompletions!;
		expect(complete("edit ")?.map((item: any) => item.value)).toEqual([`edit ${promotion.slug}`]);
		expect(complete("accept")?.map((item: any) => item.value)).toEqual([`accept ${promotion.slug}`]);
		expect(complete("accept use")?.map((item: any) => item.value)).toEqual([`accept ${promotion.slug}`]);
		await fake.commands.get("adr")!.handler("accept AAA", fake.context);
		expect(fake.lastNotice()).toMatch(/Unknown ADR slug/);

		const accepted = await acceptPromotedDecision(promotion.state, promotion.slug);
		if (!accepted.ok) throw new Error("acceptance unexpectedly conflicted");
		const acceptedFake = fakeExtension(promotion.root);
		await acceptedFake.load(accepted.state);
		const acceptedComplete = acceptedFake.commands.get("adr")!.getArgumentCompletions!;
		expect(acceptedComplete("accept")).toEqual([]);
		expect(acceptedComplete("edit ")).toEqual([]);
		expect(acceptedComplete("discard ")).toEqual([]);
		expect(acceptedComplete("reload")?.map((item: any) => item.value)).toEqual([`reload ${promotion.slug}`]);
	});
});

describe("safe repository root", () => {
	it("refuses a cwd outside any Git repository and never searches nested repositories", async () => {
		const parent = await tempDir();
		await mkdir(path.join(parent, "nested", ".git"), { recursive: true });
		await expect(resolveGitRepositoryRoot(parent)).rejects.toThrow(/not inside a Git repository.*--repo/);
	});

	it("resolves the containing Git root from a subdirectory", async () => {
		const root = await tempDir(true);
		await mkdir(path.join(root, "src", "deep"), { recursive: true });
		expect(await resolveGitRepositoryRoot(path.join(root, "src", "deep"))).toBe(root);
	});

	it("accepts an explicit, canonical Git root and refuses non-roots and symlinked markers", async () => {
		const parent = await tempDir();
		const repository = path.join(parent, "repo");
		await mkdir(path.join(repository, ".git"), { recursive: true });
		await writeFile(path.join(parent, "worktree-marker"), "");
		expect(await resolveGitRepositoryRoot(parent, "repo")).toBe(repository);
		expect(await resolveGitRepositoryRoot("/", repository)).toBe(repository);
		await mkdir(path.join(repository, "sub"));
		await expect(resolveGitRepositoryRoot(parent, "repo/sub")).rejects.toThrow(/not a Git repository root; its repository root is/);
		await expect(resolveGitRepositoryRoot(parent, "missing")).rejects.toThrow(/does not exist/);
		const fakeRepository = path.join(parent, "fake");
		await mkdir(fakeRepository);
		await symlink(path.join(repository, ".git"), path.join(fakeRepository, ".git"));
		await expect(resolveGitRepositoryRoot(parent, "fake")).rejects.toThrow(/not a Git repository root/);
		// A `.git` file (linked worktree) is a valid marker.
		const worktree = path.join(parent, "worktree");
		await mkdir(worktree);
		await writeFile(path.join(worktree, ".git"), "gitdir: elsewhere\n");
		expect(await resolveGitRepositoryRoot(parent, "worktree")).toBe(worktree);
	});

	it("parses promote IDs, a stable slug, and a verbatim --repo path", () => {
		expect(parsePromoteArguments(" aaa BBB ")).toEqual({ ids: ["AAA", "BBB"] });
		expect(parsePromoteArguments("AAA --slug http-400-for-invalid-input --repo /tmp/my repo ")).toEqual({ ids: ["AAA"], slug: "http-400-for-invalid-input", repository: "/tmp/my repo" });
		expect(() => parsePromoteArguments("AAA --slug Not_A_Slug")).toThrow(/ADR slug/);
		expect(() => parsePromoteArguments("AAA --repo")).toThrow(/requires a repository path/);
	});

	it("refuses to promote outside a Git repository before review, then succeeds with --repo", async () => {
		const outside = await tempDir();
		const repository = await tempDir(true);
		const fake = fakeExtension(outside);
		await fake.load(state());
		await fake.commands.get("decision")!.handler("promote AAA", fake.context);
		expect(fake.context.ui.editor).not.toHaveBeenCalled();
		expect(fake.lastNotice()).toMatch(/not inside a Git repository/);
		expect(await adrFiles(outside)).toEqual([]);

		fake.context.ui.editor.mockImplementation(async (_title: string, body: string) => body);
		await fake.commands.get("decision")!.handler(`promote AAA --slug local-storage --repo ${repository}`, fake.context);
		expect(await adrFiles(repository)).toEqual(["local-storage.md"]);
		expect(await adrFiles(outside)).toEqual([]);
		expect(findDurablePromotion(fake.state(), "AAA")).toMatchObject({ repositoryRoot: repository, slug: "local-storage" });
		expect(findRegisteredAdr(fake.state(), "local-storage")?.adrId).toBe(findDurablePromotion(fake.state(), "AAA")?.adrId);
	});

	it("refuses duplicate registry slugs before writing another ADR", async () => {
		const repository = await tempDir(true);
		const first = await promoteReviewedBody(state(), { repositoryRoot: repository, reviewedBody: promotionReviewBody(state(), ["AAA"]).body, sourceIds: ["AAA"], slug: "persistence" });
		await expect(promoteReviewedBody(first.state, { repositoryRoot: repository, reviewedBody: promotionReviewBody(first.state, ["CCC"]).body, sourceIds: ["CCC"], slug: "persistence" })).rejects.toThrow(/slug already registered/);
		expect(await adrFiles(repository)).toEqual(["persistence.md"]);
	});
});

describe("skill-synthesized candidates", () => {
	it("lets the agent pass synthesized Markdown directly into exact interactive review", async () => {
		const root = await tempDir(true);
		const fake = fakeExtension(root);
		await fake.load(state());

		fake.context.ui.editor.mockResolvedValueOnce(undefined);
		const cancelled = await fake.tool.execute("call", { action: "promote_adr", ids: ["AAA", "BBB"], markdown: SYNTHESIZED, slug: "storage", repository: root }, undefined, undefined, fake.context);
		expect(cancelled.content[0].text).toMatch(/cancelled.*Nothing was written/);
		expect(await adrFiles(root)).toEqual([]);
		expect(fake.state().adrs).toBeUndefined();

		fake.context.ui.editor.mockImplementationOnce(async (_title: string, body: string) => body);
		const promoted = await fake.tool.execute("call", { action: "promote_adr", ids: ["AAA", "BBB"], markdown: SYNTHESIZED, slug: "storage", repository: root }, undefined, undefined, fake.context);
		expect(fake.context.ui.editor).toHaveBeenLastCalledWith("Review exact ADR Markdown", SYNTHESIZED);
		expect(promoted.content[0].text).toContain("ADR storage");
		expect(await adrFiles(root)).toEqual(["storage.md"]);
		expect(promoted.details.state.adrs[0]).toMatchObject({ slug: "storage", sourceDecisionIds: ["AAA", "BBB"] });
	});

	it("validates sources before review and reviewed Markdown before writing", async () => {
		const root = await tempDir(true);
		const fake = fakeExtension(root);
		await fake.load(state());
		const duplicate = await fake.tool.execute("call", { action: "promote_adr", ids: ["AAA", "aaa"], markdown: SYNTHESIZED, repository: root }, undefined, undefined, fake.context);
		expect(duplicate.details.error).toMatch(/duplicate/);
		expect(fake.context.ui.editor).not.toHaveBeenCalled();

		fake.context.ui.editor.mockResolvedValueOnce("# Invalid\n");
		const invalid = await fake.tool.execute("call", { action: "promote_adr", ids: ["AAA", "BBB"], markdown: SYNTHESIZED, repository: root }, undefined, undefined, fake.context);
		expect(invalid.details.error).toMatch(/recognized section/);
		expect(await adrFiles(root)).toEqual([]);
	});

	it("refuses direct multi-source slash promotion instead of concatenating sources", async () => {
		const root = await tempDir(true);
		const fake = fakeExtension(root);
		await fake.load(state());
		await fake.commands.get("decision")!.handler("promote AAA BBB", fake.context);
		expect(fake.context.ui.editor).not.toHaveBeenCalled();
		expect(fake.lastNotice()).toMatch(/agent.*promote_adr/);
		expect(await adrFiles(root)).toEqual([]);
	});

	it("writes the exact reviewed text supplied by the agent", async () => {
		const root = await tempDir(true);
		const reviewed = SYNTHESIZED.replace("Use SQLite, migrated with Atlas, because it preserves local operation with declarative migrations.", "Use SQLite; Atlas migrates it.");
		const outcome = await promoteReviewedBody(state(), { repositoryRoot: root, reviewedBody: reviewed, sourceIds: ["AAA", "BBB"] });
		expect(importDurableAdr(await readFile(outcome.absolutePath, "utf8")).decision).toBe("Use SQLite; Atlas migrates it.");
	});

	it("keeps deterministic direct review for a single source", () => {
		expect(promotionReviewBody(state(), ["CCC"]).body).toContain("# Cache layer");
	});
});

describe("draft revision and retry", () => {
	it("replaces a draft body exactly while preserving foreign frontmatter and line endings", () => {
		const base = createDurableAdr({ title: "T", context: "P\n\nC", optionsConsidered: [], decision: "D", consequences: "Q" });
		const withForeign = base.source.replace("---\n", "---\nowner: team\n").replace(/\n/g, "\r\n");
		const body = durableAdrBody(withForeign);
		expect(body.startsWith("# T\n")).toBe(true);
		expect(replaceDurableAdrBody(withForeign, body)).toBe(withForeign);
		const edited = replaceDurableAdrBody(withForeign, body.replace("\nD\n", "\nD, revised\n") + "\n## Notes\n\nKept verbatim.\n");
		expect(edited).toContain("owner: team\r\n");
		expect(edited).toContain("## Notes\r\n\r\nKept verbatim.\r\n");
		expect(edited).not.toMatch(/[^\r]\n/);
		expect(importDurableAdr(edited).decision).toBe("D, revised");
		const accepted = updateDurableAdr(base.source, { lifecycle: "accepted" });
		expect(() => replaceDurableAdrBody(accepted, durableAdrBody(accepted))).toThrow(/only a draft/);
	});

	it("edits a repository draft with conflict-checked publishing", async () => {
		const promotion = await promoted();
		const body = await promotedDraftBody(promotion.state, promotion.slug);
		expect(body).toBe(SYNTHESIZED);
		const revised = body.replace("persistence stays local", "persistence stays local and is backed up nightly");
		const result = await editPromotedDecision(promotion.state, promotion.slug, revised);
		if (!result.ok) throw new Error("edit unexpectedly conflicted");
		const written = await readFile(promotion.absolute, "utf8");
		expect(durableAdrBody(written)).toBe(revised);
		expect(findDurablePromotion(result.state, "AAA")!.baseSource).toBe(written);
		expect(findDurablePromotion(result.state, "BBB")!.baseSource).toBe(written);

		// The old working copy now conflicts instead of overwriting.
		const stale = await editPromotedDecision(promotion.state, promotion.slug, body);
		expect(stale).toMatchObject({ ok: false, conflict: { reason: "source-changed" } });
		expect(await readFile(promotion.absolute, "utf8")).toBe(written);
		await expect(promotedDraftBody(promotion.state, promotion.slug)).rejects.toThrow(/\/adr reload/);
	});

	it("reloads a direct external edit only on request, after which edit and accept work", async () => {
		const promotion = await promoted();
		const external = updateDurableAdr(await readFile(promotion.absolute, "utf8"), { decision: "Use Postgres." });
		await writeFile(promotion.absolute, external);
		expect(await acceptPromotedDecision(promotion.state, promotion.slug)).toMatchObject({ ok: false });
		const reloaded = await reloadPromotedDecision(promotion.state, promotion.slug);
		expect(reloaded.changed).toBe(true);
		expect(findDurablePromotion(reloaded.state, "BBB")!.baseSource).toBe(external);
		expect((await reloadPromotedDecision(reloaded.state, promotion.slug)).changed).toBe(false);
		const accepted = await acceptPromotedDecision(reloaded.state, promotion.slug);
		if (!accepted.ok) throw new Error("acceptance unexpectedly conflicted");
		expect(importDurableAdr(await readFile(promotion.absolute, "utf8")).lifecycle).toBe("accepted");
		await expect(promotedDraftBody(accepted.state, promotion.slug)).rejects.toThrow(/only draft/);
	});

	it("refuses to reload a file that holds a different ADR", async () => {
		const promotion = await promoted();
		const foreign = createDurableAdr({ title: "Other", context: "P\n\nC", optionsConsidered: [], decision: "D", consequences: "Q" });
		await writeFile(promotion.absolute, foreign.source);
		await expect(reloadPromotedDecision(promotion.state, promotion.slug)).rejects.toThrow(/holds ADR/);
	});

	it("discards an unchanged draft and detaches every source without retaining candidate state", async () => {
		const promotion = await promoted();
		const result = await discardPromotedDraft(promotion.state, promotion.slug);
		expect(await adrFiles(promotion.root)).toEqual([]);
		expect(result.state.ledger!.items.every((item) => item.adrId === undefined)).toBe(true);
		expect(result.state.ledger!.items.map((item) => item.record)).toEqual(state().ledger!.items.map((item) => item.record));
		expect(result.state.adrs).toEqual([]);
		const other = await tempDir(true);
		const retried = await promoteReviewedBody(result.state, { repositoryRoot: other, reviewedBody: SYNTHESIZED, sourceIds: ["AAA", "BBB"] });
		expect(findDurablePromotion(retried.state, "AAA")!.repositoryRoot).toBe(other);
	});

	it("refuses discard when bytes changed, the ADR is accepted, or the file is missing", async () => {
		const changed = await promoted();
		const original = await readFile(changed.absolute, "utf8");
		await writeFile(changed.absolute, `${original}\n`);
		await expect(discardPromotedDraft(changed.state, changed.slug)).rejects.toThrow(/changed/);
		expect(await readFile(changed.absolute, "utf8")).toBe(`${original}\n`);

		const accepted = await promoted();
		const acceptance = await acceptPromotedDecision(accepted.state, accepted.slug);
		if (!acceptance.ok) throw new Error("acceptance unexpectedly conflicted");
		await expect(discardPromotedDraft(acceptance.state, accepted.slug)).rejects.toThrow(/only an unchanged draft/);
		await expect(deleteDurableDraft(await checkoutDurableAdr({ repositoryRoot: accepted.root, relativePath: findDurablePromotion(acceptance.state, "AAA")!.relativePath }))).rejects.toThrow(/only a draft/);
		expect(await adrFiles(accepted.root)).toHaveLength(1);

		const missing = await promoted();
		await rm(missing.absolute);
		await expect(discardPromotedDraft(missing.state, missing.slug)).rejects.toThrow();
		expect(findDurablePromotion(missing.state, "AAA")).toBeDefined();
	});

	it("wires slug-based edit, reload, and discard commands through explicit review and confirmation", async () => {
		const promotion = await promoted();
		const fake = fakeExtension(promotion.root);
		await fake.load(promotion.state);
		const revised = SYNTHESIZED.replace("Use SQLite, migrated with Atlas, because it preserves local operation with declarative migrations.", "Use SQLite with Atlas migrations.");
		fake.context.ui.editor.mockResolvedValueOnce(revised);
		await fake.commands.get("adr")!.handler(`edit ${promotion.slug}`, fake.context);
		expect(durableAdrBody(await readFile(promotion.absolute, "utf8"))).toBe(revised);

		// An external edit while reviewing is refused and the reviewed text is kept.
		fake.context.ui.editor.mockImplementationOnce(async (_title: string, body: string) => {
			await writeFile(promotion.absolute, updateDurableAdr(await readFile(promotion.absolute, "utf8"), { consequences: "External." }));
			return body.replace("migration discipline", "careful migration discipline");
		});
		await fake.commands.get("adr")!.handler(`edit ${promotion.slug}`, fake.context);
		expect(fake.lastNotice()).toMatch(/Edit refused/);
		expect(fake.pi.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining("careful migration discipline") }), { triggerTurn: false });
		expect(importDurableAdr(await readFile(promotion.absolute, "utf8")).consequences).toBe("External.");

		fake.context.ui.confirm.mockResolvedValueOnce(false);
		await fake.commands.get("adr")!.handler(`discard ${promotion.slug}`, fake.context);
		expect(await adrFiles(promotion.root)).toHaveLength(1);
		fake.context.ui.confirm.mockResolvedValueOnce(true);
		await fake.commands.get("adr")!.handler(`discard ${promotion.slug}`, fake.context);
		expect(fake.lastNotice()).toMatch(/Discard refused/);
		expect(await adrFiles(promotion.root)).toHaveLength(1);

		fake.context.ui.confirm.mockResolvedValueOnce(true);
		await fake.commands.get("adr")!.handler(`reload ${promotion.slug}`, fake.context);
		expect(fake.lastNotice()).toMatch(/Reloaded/);
		fake.context.ui.confirm.mockResolvedValueOnce(true);
		await fake.commands.get("adr")!.handler(`discard ${promotion.slug}`, fake.context);
		expect(await adrFiles(promotion.root)).toEqual([]);
		expect(findDurablePromotion(fake.state(), "BBB")).toBeUndefined();
		expect(fake.state().adrs).toEqual([]);
	});
});

function fakeExtension(cwd: string) {
	const handlers = new Map<string, (event: any, ctx: any) => unknown>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions?: (prefix: string) => any[] | null }>();
	let tool: any;
	let entries: any[] = [];
	let entryNumber = 0;
	const push = (entry: any) => { entries = [...entries, { id: `entry-${entryNumber++}`, ...entry }]; };
	const pi: any = {
		on: (event: string, handler: any) => handlers.set(event, handler),
		registerTool: (definition: unknown) => { tool = definition; },
		registerCommand: (name: string, definition: any) => commands.set(name, definition),
		registerMessageRenderer: vi.fn(),
		appendEntry: vi.fn((customType: string, data: unknown) => push({ type: "custom", customType, data })),
		setLabel: vi.fn(),
		sendMessage: vi.fn((message: any) => push({ type: "custom_message", ...message })),
		sendUserMessage: vi.fn(),
	};
	const context: any = {
		cwd,
		mode: "tui",
		hasUI: true,
		ui: {
			theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text, strikethrough: (text: string) => text },
			notify: vi.fn(),
			setWidget: vi.fn(),
			addAutocompleteProvider: vi.fn(),
			editor: vi.fn(),
			confirm: vi.fn(),
			custom: vi.fn(),
		},
		sessionManager: { getBranch: () => entries, getEntries: () => entries, getLeafId: () => entries.at(-1)?.id },
		isIdle: () => true,
	};
	decisionLedgerExtension(pi);
	return {
		pi,
		tool,
		commands,
		context,
		async load(initial: LedgerState) {
			push({ type: "custom", customType: "pi-decision-ledger", data: { extension: "pi-decision-ledger", version: 1, source: "command", state: initial } });
			await handlers.get("session_start")!({ reason: "startup" }, context);
		},
		/** Pi persists tool results; replay reads the state from their details. */
		recordToolResult(result: any) {
			push({ type: "message", message: { role: "toolResult", toolName: "decision_ledger", details: result.details } });
		},
		state: () => replayLedgerBranch(entries),
		lastNotice: (): string => context.ui.notify.mock.calls.at(-1)?.[0] ?? "",
	};
}
