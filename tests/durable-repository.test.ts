import { mkdtemp, chmod, readFile, readdir, rm, writeFile, realpath, symlink, stat } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDurableAdr, importDurableAdr } from "../src/durable.ts";
import {
	acceptDurableAdr,
	checkoutDurableAdr,
	createDurableAdrFile,
	durableAdrExists,
	publishDurablePatch,
	reloadDurableCheckout,
	resolveAdrPath,
	workingCopy,
	type RepositoryProvenance,
} from "../src/durable-repository.ts";

vi.mock("node:fs/promises", async (importOriginal) => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));

const id = "123e4567-e89b-42d3-a456-426614174000";

const fields = {
	title: "Choose storage",
	context: "We need durable storage. The application is local-first.",
	optionsConsidered: ["SQLite", "JSON"],
	decision: "Use SQLite.",
	consequences: "A migration path is required.",
};

const roots: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) {
		await chmod(path.join(root, "decisions"), 0o700).catch(() => {});
		await rm(root, { recursive: true, force: true });
	}
});

async function repository(): Promise<RepositoryProvenance> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-durable-"));
	roots.push(root);
	return { repositoryRoot: root, relativePath: "decisions/0001-choose-storage.md" };
}

/** A foreign edit in an opaque region: different bytes, identical semantics. */
function withOpaqueNote(source: string): string {
	return source.replace("---\n\n# Choose storage", "---\n\n<!-- unrelated note -->\n\n# Choose storage");
}

async function seed(): Promise<RepositoryProvenance> {
	const provenance = await repository();
	await createDurableAdrFile(provenance, createDurableAdr({ ...fields, id }));
	return provenance;
}

describe("repository provenance and paths", () => {
	it("refuses acceptance of an incomplete draft without changing it", async () => {
		const provenance = await repository();
		const adr = createDurableAdr({ ...fields, title: "", context: "", optionsConsidered: [], decision: "", consequences: "", id });
		await createDurableAdrFile(provenance, adr);
		const checkout = await checkoutDurableAdr(provenance);
		await expect(acceptDurableAdr(checkout)).rejects.toThrow(/incomplete ADR/);
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(checkout.baseSource);
		// An incomplete draft remains a valid editable draft.
		const edited = await publishDurablePatch(checkout, { title: "Completed title" });
		expect(edited.ok).toBe(true);
	});
	it("resolves an in-repository path and refuses escapes", () => {
		const root = path.resolve("/tmp/example-repo");
		expect(resolveAdrPath({ repositoryRoot: root, relativePath: "decisions/a.md" })).toBe(path.join(root, "decisions", "a.md"));
		expect(() => resolveAdrPath({ repositoryRoot: root, relativePath: "../outside.md" })).toThrow("parent segments");
		expect(() => resolveAdrPath({ repositoryRoot: root, relativePath: path.join(root, "a.md") })).toThrow("relative path");
		expect(() => resolveAdrPath({ repositoryRoot: "relative/root", relativePath: "a.md" })).toThrow("absolute path");
	});

	it("creates a draft exclusively and refuses to replace an existing file", async () => {
		const provenance = await seed();
		const absolutePath = resolveAdrPath(provenance);
		const before = await readFile(absolutePath, "utf8");
		expect(await durableAdrExists(provenance)).toBe(true);
		await expect(createDurableAdrFile(provenance, createDurableAdr({ ...fields, title: "Other" }))).rejects.toMatchObject({ code: "EEXIST" });
		expect(await readFile(absolutePath, "utf8")).toBe(before);
	});

	it("rejects source bytes that are not valid UTF-8 instead of replacing them", async () => {
		const provenance = await seed();
		await writeFile(resolveAdrPath(provenance), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a]));
		await expect(checkoutDurableAdr(provenance)).rejects.toThrow("not valid UTF-8");
	});
});

describe("checkout as a working copy", () => {
	it("carries durable UUID, provenance, digests, fingerprint and original source", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		const copy = workingCopy(checkout);
		expect(copy.id).toBe(id);
		expect(copy.lifecycle).toBe("draft");
		expect(copy.provenance).toEqual({ ...provenance, repositoryRoot: await realpath(provenance.repositoryRoot) });
		expect(copy.baseSemanticDigest).toBe(checkout.adr.semanticDigest);
		expect(copy.baseSourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(copy.baseSource).toBe(await readFile(checkout.absolutePath, "utf8"));
	});
});

describe("conflict-checked publishing", () => {
	it("publishes a patch to an unchanged file and keeps the durable ID", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		const result = await publishDurablePatch(checkout, { decision: "Use Postgres." });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.changed).toBe(true);
		expect(result.checkout.id).toBe(id);
		expect(result.checkout.adr.decision).toBe("Use Postgres.");
		expect(result.checkout.baseSemanticDigest).not.toBe(checkout.baseSemanticDigest);
		const onDisk = await readFile(checkout.absolutePath, "utf8");
		expect(onDisk).toBe(result.checkout.baseSource);
		expect(importDurableAdr(onDisk).decision).toBe("Use Postgres.");
	});

	it("refuses a semantically irrelevant byte change and preserves the proposed edits", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		const meddled = withOpaqueNote(checkout.baseSource);
		expect(meddled).not.toBe(checkout.baseSource);
		await writeFile(checkout.absolutePath, meddled, "utf8");

		const result = await publishDurablePatch(checkout, { decision: "Use Postgres." });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const { conflict } = result;
		expect(conflict.reason).toBe("source-changed");
		expect(conflict.id).toBe(id);
		// The meddling was semantically irrelevant, yet exact-source still refuses.
		expect(conflict.actual?.semanticDigest).toBe(conflict.base.semanticDigest);
		expect(conflict.actual?.sourceFingerprint).not.toBe(conflict.base.sourceFingerprint);
		expect(conflict.patch).toEqual({ decision: "Use Postgres." });
		expect(importDurableAdr(conflict.proposedSource).decision).toBe("Use Postgres.");
		// Nothing was merged or overwritten.
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(meddled);
	});

	it("reports a missing authoritative file as a conflict rather than recreating it", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		await rm(checkout.absolutePath);
		const result = await publishDurablePatch(checkout, { decision: "Use Postgres." });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.conflict.reason).toBe("missing-file");
		expect(result.conflict.actual).toBeUndefined();
		expect(await durableAdrExists(provenance)).toBe(false);
	});

	it("recovers manually through an explicit reload and republish", async () => {
		const provenance = await seed();
		const stale = await checkoutDurableAdr(provenance);
		await writeFile(stale.absolutePath, withOpaqueNote(stale.baseSource), "utf8");
		expect((await publishDurablePatch(stale, { decision: "Use Postgres." })).ok).toBe(false);

		const reloaded = await reloadDurableCheckout(stale);
		expect(reloaded.id).toBe(stale.id);
		expect(reloaded.baseSourceFingerprint).not.toBe(stale.baseSourceFingerprint);
		const result = await publishDurablePatch(reloaded, { decision: "Use Postgres." });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.checkout.adr.decision).toBe("Use Postgres.");
		// The unrelated foreign edit survived the update.
		expect(result.checkout.baseSource).toContain("<!-- unrelated note -->");
	});

	it("refuses a reload when the file no longer holds the same durable identity", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		await writeFile(checkout.absolutePath, createDurableAdr({ ...fields }).source, "utf8");
		await expect(reloadDurableCheckout(checkout)).rejects.toThrow("durable identity changed");
	});

	it("leaves no temporary files behind on success or on a failed write", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		const directory = path.dirname(checkout.absolutePath);
		expect((await publishDurablePatch(checkout, { decision: "Use Postgres." })).ok).toBe(true);
		expect(await readdir(directory)).toEqual([path.basename(checkout.absolutePath)]);

		const current = await checkoutDurableAdr(provenance);
		await chmod(directory, 0o500);
		await expect(publishDurablePatch(current, { decision: "Use DynamoDB." })).rejects.toMatchObject({ code: "EACCES" });
		await chmod(directory, 0o700);
		expect(await readdir(directory)).toEqual([path.basename(checkout.absolutePath)]);
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(current.baseSource);
	});
});

describe("adversarial repository safety", () => {
	it("snapshots and freezes checkout provenance instead of retaining caller aliases", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		const original = checkout.absolutePath;
		(provenance as { relativePath: string }).relativePath = "other.md";
		expect(checkout.absolutePath).toBe(original);
		expect(Object.isFrozen(checkout)).toBe(true);
		expect(Object.isFrozen(checkout.provenance)).toBe(true);
		expect(Object.isFrozen(workingCopy(checkout).provenance)).toBe(true);
		expect((await publishDurablePatch(checkout, { decision: "Still the original file" })).ok).toBe(true);
	});

	it("rejects inconsistent checkout identities and fingerprints before writing", async () => {
		const checkout = await checkoutDurableAdr(await seed());
		for (const changed of [{ id: "forged" }, { baseSourceFingerprint: "forged" }, { absolutePath: checkout.absolutePath + ".other" }, { lifecycle: "accepted" as const }]) {
			await expect(acceptDurableAdr({ ...checkout, ...changed })).rejects.toThrow("inconsistent durable checkout");
		}
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(checkout.baseSource);
	});

	it("rejects invalid, inconsistent and already accepted creation before making files", async () => {
		const provenance = await repository();
		const adr = createDurableAdr({ ...fields, id });
		await expect(createDurableAdrFile(provenance, { ...adr, source: "bad" })).rejects.toThrow();
		await expect(createDurableAdrFile(provenance, { ...adr, id: "forged" })).rejects.toThrow("inconsistent");
		await expect(createDurableAdrFile(provenance, createDurableAdr({ ...fields, lifecycle: "accepted" }))).rejects.toThrow("draft");
		expect(await readdir(provenance.repositoryRoot)).toEqual([]);
	});

	it("refuses symlinked parents and symlinked final files without touching their targets", async () => {
		const outside = await seed();
		const provenance = await repository();
		await symlink(path.dirname(resolveAdrPath(outside)), path.join(provenance.repositoryRoot, "decisions"));
		await expect(checkoutDurableAdr(provenance)).rejects.toThrow("unsafe ADR directory");
		await expect(createDurableAdrFile(provenance, createDurableAdr({ ...fields, id }))).rejects.toThrow("unsafe ADR directory");
		const checkout = await checkoutDurableAdr(outside);
		await rm(checkout.absolutePath);
		const target = path.join(outside.repositoryRoot, "target.md");
		await writeFile(target, checkout.baseSource);
		await symlink(target, checkout.absolutePath);
		await expect(checkoutDurableAdr(outside)).rejects.toThrow();
		const result = await publishDurablePatch(checkout, { decision: "Do not overwrite" });
		expect(result).toMatchObject({ ok: false, conflict: { reason: "unreadable-file", patch: { decision: "Do not overwrite" } } });
		expect(await readFile(target, "utf8")).toBe(checkout.baseSource);
	});

	it("retains invalid UTF-8 conflict bytes and the intended patch without misreporting deletion", async () => {
		const checkout = await checkoutDurableAdr(await seed());
		const bytes = Buffer.from([0xff, 0xfe]);
		await writeFile(checkout.absolutePath, bytes);
		const result = await publishDurablePatch(checkout, { decision: "Recover this edit" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.conflict.reason).toBe("source-changed");
		expect(result.conflict.actual?.source).toBeUndefined();
		expect(result.conflict.actual?.bytesBase64).toBe(bytes.toString("base64"));
		expect(result.conflict.actual?.sourceFingerprint).toBe(createHash("sha256").update(bytes).digest("hex"));
		expect(importDurableAdr(result.conflict.proposedSource).decision).toBe("Recover this edit");
	});

	it("preserves a restrictive file mode and BOM across replacement", async () => {
		const provenance = await seed();
		const absolute = resolveAdrPath(provenance);
		await writeFile(absolute, "\uFEFF" + await readFile(absolute, "utf8"));
		await chmod(absolute, 0o640);
		const checkout = await checkoutDurableAdr(provenance);
		expect(checkout.baseSourceFingerprint).toBe(createHash("sha256").update(await readFile(absolute)).digest("hex"));
		expect((await acceptDurableAdr(checkout)).ok).toBe(true);
		expect((await stat(absolute)).mode & 0o777).toBe(0o640);
		expect((await readFile(absolute, "utf8")).startsWith("\uFEFF")).toBe(true);
	});

	it("rechecks source after temporary-file preparation and removes the temporary file on conflict", async () => {
		const checkout = await checkoutDurableAdr(await seed());
		const originalLstat = fs.lstat;
		const foreign = withOpaqueNote(checkout.baseSource);
		vi.spyOn(fs, "lstat").mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
			const value = await originalLstat(...args);
			if (args[0] === checkout.absolutePath) await writeFile(checkout.absolutePath, foreign);
			return value;
		}) as typeof fs.lstat);
		const result = await publishDurablePatch(checkout, { decision: "Intended edit" });
		expect(result).toMatchObject({ ok: false, conflict: { reason: "source-changed", patch: { decision: "Intended edit" } } });
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(foreign);
		expect(await readdir(path.dirname(checkout.absolutePath))).toEqual([path.basename(checkout.absolutePath)]);
	});

	it("retains edits and cleans the prepared file when rename fails", async () => {
		const checkout = await checkoutDurableAdr(await seed());
		vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("rename failed"), { code: "EIO" }));
		await expect(publishDurablePatch(checkout, { decision: "Recover me" })).rejects.toMatchObject({ code: "EIO", patch: { decision: "Recover me" }, proposedSource: expect.stringContaining("Recover me") });
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(checkout.baseSource);
		expect(await readdir(path.dirname(checkout.absolutePath))).toEqual([path.basename(checkout.absolutePath)]);
	});

	it("cleans creation staging when exclusive publication fails", async () => {
		const provenance = await seed();
		await expect(createDurableAdrFile(provenance, createDurableAdr({ ...fields, id }))).rejects.toMatchObject({ code: "EEXIST" });
		expect(await readdir(path.dirname(resolveAdrPath(provenance)))).toEqual([path.basename(provenance.relativePath)]);
	});

	it("cleans partial temporary files after write failure during creation or publishing", async () => {
		const checkout = await checkoutDurableAdr(await seed());
		const creation = await repository();
		const originalOpen = fs.open;
		vi.spyOn(fs, "open").mockImplementation(async (...args) => {
			const handle = await originalOpen(...args);
			if (String(args[0]).endsWith(".tmp")) {
				const originalWrite = handle.writeFile.bind(handle);
				vi.spyOn(handle, "writeFile").mockImplementation(async () => {
					await originalWrite("partial");
					throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
				});
			}
			return handle;
		});
		await expect(createDurableAdrFile(creation, createDurableAdr({ ...fields, id }))).rejects.toMatchObject({ code: "ENOSPC" });
		expect(await readdir(path.dirname(resolveAdrPath(creation)))).toEqual([]);
		await expect(publishDurablePatch(checkout, { decision: "Recover after disk full" })).rejects.toMatchObject({ code: "ENOSPC", patch: { decision: "Recover after disk full" } });
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(checkout.baseSource);
		expect(await readdir(path.dirname(checkout.absolutePath))).toEqual([path.basename(checkout.absolutePath)]);
	});

	it("does not accept a digest-tampered authoritative draft", async () => {
		const checkout = await checkoutDurableAdr(await seed());
		const tampered = checkout.baseSource.replace("Use SQLite.", "Use tampered content.");
		await writeFile(checkout.absolutePath, tampered);
		expect(await acceptDurableAdr(checkout)).toMatchObject({ ok: false, conflict: { reason: "source-changed", patch: { lifecycle: "accepted" } } });
		await expect(checkoutDurableAdr(checkout.provenance)).rejects.toThrow("digest mismatch");
		expect(await readFile(checkout.absolutePath, "utf8")).toBe(tampered);
	});
});

describe("acceptance", () => {
	it("is an explicit draft -> accepted transition that keeps the ID and body bytes", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		const bodyBefore = checkout.baseSource.slice(checkout.baseSource.indexOf("\n---\n") + 5);

		const result = await acceptDurableAdr(checkout);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.changed).toBe(true);
		expect(result.checkout.id).toBe(id);
		expect(result.checkout.lifecycle).toBe("accepted");
		expect(result.checkout.baseSemanticDigest).toBe(checkout.baseSemanticDigest);
		expect(result.checkout.baseSource.slice(result.checkout.baseSource.indexOf("\n---\n") + 5)).toBe(bodyBefore);
	});

	it("recognizes an equivalent manual YAML acceptance without rewriting the file", async () => {
		const provenance = await seed();
		const draft = await checkoutDurableAdr(provenance);
		await writeFile(draft.absolutePath, draft.baseSource.replace("status: proposed", "status: accepted"), "utf8");

		const manual = await checkoutDurableAdr(provenance);
		expect(manual.lifecycle).toBe("accepted");
		const before = manual.baseSource;
		const result = await acceptDurableAdr(manual);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.changed).toBe(false);
		expect(result.checkout.id).toBe(id);
		expect(await readFile(manual.absolutePath, "utf8")).toBe(before);
	});

	it("refuses to accept a superseded ADR", async () => {
		const provenance = await seed();
		const checkout = await checkoutDurableAdr(provenance);
		const published = await publishDurablePatch(checkout, { lifecycle: "superseded" });
		expect(published.ok).toBe(true);
		if (!published.ok) return;
		await expect(acceptDurableAdr(published.checkout)).rejects.toThrow("only a draft ADR can be accepted");
	});
});
