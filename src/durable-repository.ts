import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as os from "node:os";
import { type DurableAdr, type DurableAdrPatch, type DurableLifecycle, importDurableAdr, replaceDurableAdrBody, updateDurableAdr, validateDurableAdrBody } from "./durable.ts";

export interface RepositoryProvenance {
	readonly repositoryRoot: string;
	readonly relativePath: string;
}

/** Session values are working copies once the repository draft exists. */
export interface DurableWorkingCopy {
	readonly id: string;
	readonly lifecycle: DurableLifecycle;
	readonly provenance: RepositoryProvenance;
	readonly baseSemanticDigest: string;
	readonly baseSourceFingerprint: string;
	readonly baseSource: string;
}

export interface DurableCheckout extends DurableWorkingCopy {
	readonly absolutePath: string;
	readonly adr: DurableAdr;
}

export interface DurableConflict {
	readonly kind: "conflict";
	readonly reason: "source-changed" | "missing-file" | "unreadable-file";
	readonly absolutePath: string;
	readonly id: string;
	readonly base: { readonly semanticDigest: string; readonly sourceFingerprint: string; readonly source: string };
	/** Invalid UTF-8 is retained losslessly as base64, never replacement text. */
	readonly actual?: { readonly semanticDigest?: string; readonly sourceFingerprint: string; readonly source?: string; readonly bytesBase64: string };
	readonly error?: string;
	readonly patch: DurableAdrPatch;
	readonly proposedSource: string;
}

export type DurablePublishResult =
	| { readonly ok: true; readonly checkout: DurableCheckout; readonly changed: boolean }
	| { readonly ok: false; readonly conflict: DurableConflict };

/** I/O failures retain the attempted edit just like source conflicts. */
export class DurablePublishError extends Error {
	readonly code?: string;
	constructor(readonly patch: DurableAdrPatch, readonly proposedSource: string, cause: unknown) {
		super("Could not publish durable ADR", { cause });
		this.code = (cause as NodeJS.ErrnoException)?.code;
	}
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function resolveAdrPath(provenance: RepositoryProvenance): string {
	const { repositoryRoot, relativePath } = provenance;
	if (!path.isAbsolute(repositoryRoot)) throw new Error("repositoryRoot must be an absolute path");
	if (relativePath === "" || path.isAbsolute(relativePath)) throw new Error("relativePath must be a non-empty relative path");
	if (relativePath.includes("\\") || relativePath.includes("\0") || relativePath.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
		throw new Error("relativePath must not contain empty or parent segments, dot segments, backslashes or NUL");
	}
	return path.join(path.resolve(repositoryRoot), relativePath);
}

/** Resolve the root once; reject symlinks below it, including the final file. */
async function safeProvenance(provenance: RepositoryProvenance, createParents = false): Promise<RepositoryProvenance> {
	resolveAdrPath(provenance);
	const safe = Object.freeze({ repositoryRoot: await fs.realpath(provenance.repositoryRoot), relativePath: provenance.relativePath });
	if (!(await fs.stat(safe.repositoryRoot)).isDirectory()) throw new Error("repositoryRoot must be a directory");
	let current = safe.repositoryRoot;
	const segments = safe.relativePath.split("/");
	for (const segment of segments.slice(0, -1)) {
		current = path.join(current, segment);
		if (createParents) await fs.mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
		const stat = await fs.lstat(current);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe ADR directory: ${current}`);
	}
	return safe;
}

async function readBytes(provenance: RepositoryProvenance): Promise<Buffer> {
	const safe = await safeProvenance(provenance);
	if (safe.repositoryRoot !== provenance.repositoryRoot) throw new Error("repository root changed");
	const handle = await fs.open(resolveAdrPath(safe), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
	try {
		if (!(await handle.stat()).isFile()) throw new Error("ADR must be a regular file");
		return await handle.readFile();
	} finally { await handle.close(); }
}

function decode(bytes: Buffer): string {
	try { return utf8.decode(bytes); }
	catch { throw new Error("durable ADR source is not valid UTF-8"); }
}

function toCheckout(provenance: RepositoryProvenance, source: string): DurableCheckout {
	const adr = importDurableAdr(source);
	const ownedProvenance = Object.freeze({ ...provenance });
	return Object.freeze({
		id: adr.id, lifecycle: adr.lifecycle, provenance: ownedProvenance, absolutePath: resolveAdrPath(ownedProvenance), adr,
		baseSemanticDigest: adr.semanticDigest, baseSourceFingerprint: adr.sourceFingerprint, baseSource: source,
	});
}

function validateCheckout(checkout: DurableCheckout): void {
	const base = importDurableAdr(checkout.baseSource);
	if (resolveAdrPath(checkout.provenance) !== checkout.absolutePath || base.id !== checkout.id || base.lifecycle !== checkout.lifecycle ||
		base.semanticDigest !== checkout.baseSemanticDigest || base.sourceFingerprint !== checkout.baseSourceFingerprint) {
		throw new Error("inconsistent durable checkout");
	}
}

export async function checkoutDurableAdr(provenance: RepositoryProvenance): Promise<DurableCheckout> {
	const safe = await safeProvenance({ ...provenance });
	return toCheckout(safe, decode(await readBytes(safe)));
}

export async function reloadDurableCheckout(checkout: DurableCheckout): Promise<DurableCheckout> {
	validateCheckout(checkout);
	const reloaded = await checkoutDurableAdr(checkout.provenance);
	if (reloaded.provenance.repositoryRoot !== checkout.provenance.repositoryRoot) throw new Error("repository root changed");
	if (reloaded.id !== checkout.id) throw new Error(`durable identity changed at ${checkout.absolutePath}: expected ${checkout.id}, found ${reloaded.id}`);
	return reloaded;
}

export function workingCopy(checkout: DurableCheckout): DurableWorkingCopy {
	validateCheckout(checkout);
	return Object.freeze({
		id: checkout.id, lifecycle: checkout.lifecycle, provenance: Object.freeze({ ...checkout.provenance }),
		baseSemanticDigest: checkout.baseSemanticDigest, baseSourceFingerprint: checkout.baseSourceFingerprint, baseSource: checkout.baseSource,
	});
}

/** Validate before touching disk; link publishes the complete draft exclusively. */
export async function createDurableAdrFile(provenance: RepositoryProvenance, adr: DurableAdr): Promise<DurableCheckout> {
	const verified = importDurableAdr(adr.source);
	if (!isDeepStrictEqual(verified, adr)) throw new Error("inconsistent durable ADR");
	if (verified.lifecycle !== "draft") throw new Error("repository creation requires a draft ADR");
	const safe = await safeProvenance({ ...provenance }, true);
	const absolutePath = resolveAdrPath(safe);
	const temporaryPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await fs.open(temporaryPath, "wx", 0o600);
		await handle.writeFile(verified.source, "utf8");
		await handle.close();
		await safeProvenance(safe);
		await fs.link(temporaryPath, absolutePath);
	} finally {
		if (handle) {
			try { await handle.close(); } finally { await fs.unlink(temporaryPath); }
		}
	}
	return toCheckout(safe, verified.source);
}

async function checkSource(checkout: DurableCheckout, patch: DurableAdrPatch, proposedSource: string): Promise<DurableConflict | undefined> {
	const base = { semanticDigest: checkout.baseSemanticDigest, sourceFingerprint: checkout.baseSourceFingerprint, source: checkout.baseSource };
	const common = { kind: "conflict" as const, absolutePath: checkout.absolutePath, id: checkout.id, base, patch, proposedSource };
	let bytes: Buffer;
	try { bytes = await readBytes(checkout.provenance); }
	catch (error) {
		return { ...common, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing-file" : "unreadable-file", error: String(error) };
	}
	if (bytes.equals(Buffer.from(checkout.baseSource, "utf8"))) return undefined;
	let source: string | undefined;
	let semanticDigest: string | undefined;
	try { source = decode(bytes); semanticDigest = importDurableAdr(source).semanticDigest; } catch { /* Retain undecodable or malformed bytes for recovery. */ }
	return { ...common, reason: "source-changed", actual: { source, semanticDigest, sourceFingerprint: createHash("sha256").update(bytes).digest("hex"), bytesBase64: bytes.toString("base64") } };
}

/**
 * Optimistic exact-byte checking, not a filesystem compare-and-swap. A final
 * recheck catches edits during preparation, but an external writer can still
 * race the last check and rename. Callers must coordinate concurrent writers
 * and directory changes. No merge or force-overwrite recovery is provided.
 */
export async function publishDurablePatch(checkout: DurableCheckout, patch: DurableAdrPatch): Promise<DurablePublishResult> {
	validateCheckout(checkout);
	checkout = toCheckout({ ...checkout.provenance }, checkout.baseSource);
	patch = structuredClone(patch);
	return publishProposedSource(checkout, patch, updateDurableAdr(checkout.baseSource, patch));
}

/**
 * Publish an exactly reviewed draft body with the same exact-byte checking as
 * publishDurablePatch. The frontmatter outside the owned digest is preserved.
 */
export async function publishDurableBody(checkout: DurableCheckout, reviewedBody: string): Promise<DurablePublishResult> {
	validateCheckout(checkout);
	checkout = toCheckout({ ...checkout.provenance }, checkout.baseSource);
	const fields = validateDurableAdrBody(reviewedBody);
	const patch: DurableAdrPatch = { ...fields, supersedes: [...checkout.adr.supersedes] };
	return publishProposedSource(checkout, patch, replaceDurableAdrBody(checkout.baseSource, reviewedBody));
}

async function publishProposedSource(checkout: DurableCheckout, patch: DurableAdrPatch, proposedSource: string): Promise<DurablePublishResult> {
	const conflict = await checkSource(checkout, patch, proposedSource);
	if (conflict) return { ok: false, conflict };
	if (proposedSource === checkout.baseSource) return { ok: true, checkout, changed: false };
	const temporaryPath = path.join(path.dirname(checkout.absolutePath), `.${path.basename(checkout.absolutePath)}.${randomUUID()}.tmp`);
	let handle;
	try {
		const original = await fs.lstat(checkout.absolutePath);
		if (!original.isFile()) throw new Error("ADR must be a regular file");
		handle = await fs.open(temporaryPath, "wx", 0o600);
		await handle.writeFile(proposedSource, "utf8");
		await handle.chmod(original.mode & 0o7777);
		await handle.close();
		const finalConflict = await checkSource(checkout, patch, proposedSource);
		if (finalConflict) return { ok: false, conflict: finalConflict };
		await fs.rename(temporaryPath, checkout.absolutePath);
		return { ok: true, checkout: toCheckout(checkout.provenance, proposedSource), changed: true };
	} catch (error) { throw new DurablePublishError(patch, proposedSource, error); }
	finally {
		if (handle) {
			try {
				try { await handle.close(); }
				finally { await fs.unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
			} catch (error) { throw new DurablePublishError(patch, proposedSource, error); }
		}
	}
}

export async function acceptDurableAdr(checkout: DurableCheckout): Promise<DurablePublishResult> {
	validateCheckout(checkout);
	if (checkout.lifecycle !== "draft" && checkout.lifecycle !== "accepted") throw new Error(`only a draft ADR can be accepted; ${checkout.id} is ${checkout.lifecycle}`);
	const fields = validateDurableAdrBody(checkout.baseSource.slice(checkout.baseSource.indexOf("\\n---\\n") + 5));
	if ([fields.title, fields.context, fields.decision, fields.consequences].some((field) => field.trim() === "") ||
		fields.optionsConsidered.length === 0 || fields.optionsConsidered.some((option) => option.trim() === "")) {
		throw new Error("cannot accept an incomplete ADR: title, context, considered options, decision, and consequences are required");
	}
	return publishDurablePatch(checkout, { lifecycle: "accepted" });
}

/**
 * Delete an unchanged draft. The file is first moved aside atomically, then
 * its bytes are verified against the checked-out base; anything else is put
 * back (exclusively) and refused. Accepted and superseded ADRs are never deleted.
 */
export async function deleteDurableDraft(checkout: DurableCheckout): Promise<void> {
	validateCheckout(checkout);
	checkout = toCheckout({ ...checkout.provenance }, checkout.baseSource);
	if (checkout.lifecycle !== "draft") throw new Error(`only a draft ADR can be discarded; ${checkout.id} is ${checkout.lifecycle}`);
	const conflict = await checkSource(checkout, { lifecycle: "draft" }, checkout.baseSource);
	if (conflict) throw new Error(`refusing to discard ${checkout.absolutePath}: ${conflict.reason}`);
	const asidePath = path.join(path.dirname(checkout.absolutePath), `.${path.basename(checkout.absolutePath)}.${randomUUID()}.discard`);
	await fs.rename(checkout.absolutePath, asidePath);
	let bytes: Buffer | undefined;
	try {
		const handle = await fs.open(asidePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
		try {
			if ((await handle.stat()).isFile()) bytes = await handle.readFile();
		} finally { await handle.close(); }
	} catch { bytes = undefined; }
	if (bytes !== undefined && bytes.equals(Buffer.from(checkout.baseSource, "utf8"))) {
		await fs.unlink(asidePath);
		return;
	}
	try {
		await fs.link(asidePath, checkout.absolutePath);
		await fs.unlink(asidePath);
	} catch (error) {
		throw new Error(`refusing to discard ${checkout.absolutePath}: it changed during discard and could not be restored; the changed file is at ${asidePath}`, { cause: error });
	}
	throw new Error(`refusing to discard ${checkout.absolutePath}: it changed during discard and was restored`);
}

async function hasGitMarker(directory: string): Promise<boolean> {
	try {
		const stat = await fs.lstat(path.join(directory, ".git"));
		return stat.isDirectory() || stat.isFile();
	} catch { return false; }
}

async function containingGitRoot(directory: string): Promise<string | undefined> {
	for (let current = directory; ; current = path.dirname(current)) {
		if (await hasGitMarker(current)) return current;
		if (path.dirname(current) === current) return undefined;
	}
}

/**
 * Choose the repository for a new ADR. An explicit root must itself be a Git
 * working-tree root (a `.git` directory or file, not a symlink). Otherwise the
 * nearest Git root containing cwd is used. Nested repositories below the
 * starting directory are never searched. The result is canonical.
 */
export async function resolveGitRepositoryRoot(cwd: string, explicitRoot?: string): Promise<string> {
	if (explicitRoot !== undefined) {
		const expanded = explicitRoot === "~" || explicitRoot.startsWith("~/") ? path.join(os.homedir(), explicitRoot.slice(1)) : explicitRoot;
		if (expanded.trim() === "" || expanded.includes("\0")) throw new Error("--repo requires a repository path");
		const root = await fs.realpath(path.resolve(cwd, expanded)).catch(() => { throw new Error(`repository path does not exist: ${expanded}`); });
		if (!(await fs.stat(root)).isDirectory()) throw new Error(`repository path is not a directory: ${root}`);
		if (await hasGitMarker(root)) return root;
		const containing = await containingGitRoot(root);
		throw new Error(`${root} is not a Git repository root${containing === undefined ? "" : `; its repository root is ${containing}`}`);
	}
	const start = await fs.realpath(cwd);
	const root = await containingGitRoot(start);
	if (root === undefined) throw new Error(`${start} is not inside a Git repository; rerun with --repo <path> to choose the repository explicitly`);
	return root;
}

/** An existence probe only; not authorization or a valid checkout. */
export async function durableAdrExists(provenance: RepositoryProvenance): Promise<boolean> {
	try {
		const safe = await safeProvenance({ ...provenance });
		return (await fs.lstat(resolveAdrPath(safe))).isFile();
	} catch { return false; }
}
