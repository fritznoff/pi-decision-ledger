import { createHash, randomUUID } from "node:crypto";

export const DURABLE_FORMAT_VERSION = 1 as const;
export const SEMANTIC_DIGEST_VERSION = "semantic-digest/v1" as const;
const DOMAIN_SEPARATOR = "pi-decision-ledger:semantic-digest:v1\0";
const FRONTMATTER_DELIMITER = "---";
const ENVELOPE_KEY = "x-pi-decision-ledger:";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type DurableLifecycle = "draft" | "accepted" | "superseded";
export type MadrStatus = "proposed" | "accepted" | "superseded";

export interface MadrMetadata {
	date?: string;
	decisionMakers?: string[];
	consulted?: string[];
	informed?: string[];
}

export interface DurableAdrFields {
	title: string;
	context: string;
	optionsConsidered: string[];
	decision: string;
	consequences: string;
	supersedes: string[];
}

export interface DurableAdr extends DurableAdrFields, MadrMetadata {
	id: string;
	lifecycle: DurableLifecycle;
	semanticDigest: string;
	supersededBy: string[];
	/** Exact bytes of the imported source; never used as semantic identity. */
	readonly sourceFingerprint: string;
	readonly source: string;
}

export interface DurableAdrPatch extends Partial<DurableAdrFields> {
	lifecycle?: DurableLifecycle;
	supersededBy?: string[];
}

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n|\r/g, "\n");
}

function assertString(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string") throw new Error(`${name} must be a string`);
	if (Buffer.from(value, "utf8").toString("utf8") !== value) throw new Error(`${name} must contain valid Unicode (no unpaired surrogates)`);
}

function assertUuid(value: string, name: string): void {
	if (!UUID_V4.test(value) || value !== value.toLowerCase()) throw new Error(`${name} must be a lowercase UUIDv4`);
}

function assertLifecycle(value: string): asserts value is DurableLifecycle {
	if (!(["draft", "accepted", "superseded"] as const).includes(value as DurableLifecycle)) throw new Error(`invalid durable lifecycle: ${value}`);
}

function statusForLifecycle(lifecycle: DurableLifecycle): MadrStatus {
	return lifecycle === "draft" ? "proposed" : lifecycle;
}

function lifecycleForStatus(status: string): DurableLifecycle {
	if (status === "proposed") return "draft";
	if (status === "accepted" || status === "superseded") return status;
	throw new Error(`unsupported MADR status: ${status}`);
}

function canonical(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(normalizeLineEndings(value));
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
	}
	if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
	throw new Error("unsupported value in canonical payload");
}

function digestPayload(fields: DurableAdrFields): Record<string, unknown> {
	return {
		title: normalizeLineEndings(fields.title),
		context: normalizeLineEndings(fields.context),
		optionsConsidered: fields.optionsConsidered.map(normalizeLineEndings),
		decision: normalizeLineEndings(fields.decision),
		consequences: normalizeLineEndings(fields.consequences),
		supersedes: [...fields.supersedes].sort(),
	};
}

export function semanticDigest(fields: DurableAdrFields): string {
	validateFields(fields);
	const payload = canonical(digestPayload(fields));
	return `sha256:${createHash("sha256").update(Buffer.from(DOMAIN_SEPARATOR + payload, "utf8")).digest("hex")}`;
}

/** Exact-byte fingerprint of a source document. Never a semantic identity. */
export function sourceFingerprint(source: string): string {
	assertString(source, "source");
	return createHash("sha256").update(Buffer.from(source, "utf8")).digest("hex");
}

function validateFields(fields: DurableAdrFields): void {
	for (const key of ["title", "context", "decision", "consequences"] as const) assertString(fields[key], key);
	if (!Array.isArray(fields.optionsConsidered) || fields.optionsConsidered.some((value) => typeof value !== "string")) throw new Error("optionsConsidered must be an array of strings");
	for (const value of fields.optionsConsidered) assertString(value, "list entry");
	if (!Array.isArray(fields.supersedes)) throw new Error("supersedes must be an array");
	for (const id of fields.supersedes) assertUuid(id, "supersedes entry");
	if (new Set(fields.supersedes).size !== fields.supersedes.length) throw new Error("supersedes contains duplicates");
}

function splitLines(source: string): { lines: string[]; newline: string; finalNewline: boolean; bom: boolean } {
	const newline = source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
	const bom = source.startsWith("\uFEFF");
	const normalized = normalizeLineEndings(bom ? source.slice(1) : source);
	const finalNewline = normalized.endsWith("\n");
	return { lines: normalized.split("\n"), newline, finalNewline, bom };
}

interface FrontmatterBounds {
	start: number;
	end: number;
	envelopeStart: number;
	envelopeEnd: number;
}

function frontmatterBounds(lines: string[]): FrontmatterBounds {
	if (lines[0] !== FRONTMATTER_DELIMITER) throw new Error("durable import requires YAML frontmatter");
	const end = lines.findIndex((line, index) => index > 0 && (line === FRONTMATTER_DELIMITER || line === "..."));
	if (end < 0) throw new Error("malformed YAML frontmatter: missing closing delimiter");
	const envelopes = lines.flatMap((line, index) => index > 0 && index < end && line === ENVELOPE_KEY ? [index] : []);
	if (envelopes.length > 1) throw new Error("ambiguous durable metadata: duplicate envelope");
	if (envelopes.length === 0) throw new Error("durable import requires an x-pi-decision-ledger metadata envelope");
	const envelopeStart = envelopes[0]!;
	let envelopeEnd = end;
	for (let index = envelopeStart + 1; index < end; index += 1) {
		const line = lines[index]!;
		if (line !== "" && !/^\s/.test(line)) {
			envelopeEnd = index;
			break;
		}
	}
	return { start: 0, end, envelopeStart, envelopeEnd };
}

function parseEnvelope(lines: string[], bounds: FrontmatterBounds): { id: string; semanticDigest: string; supersedes: string[]; supersededBy: string[] } {
	const values = new Map<string, string>();
	let versionSeen = false;
	for (const line of lines.slice(bounds.envelopeStart + 1, bounds.envelopeEnd)) {
		const match = /^  (version|id|semanticDigest|supersedes|supersededBy):\s*(.*)$/.exec(line);
		if (!match) {
			if (line.trim() !== "") throw new Error("unsupported or malformed metadata envelope");
			continue;
		}
		if (match[1] === "version") {
			if (versionSeen) throw new Error("duplicate metadata field: version");
			versionSeen = true;
			if (match[2] !== "1") throw new Error(`unsupported durable metadata version: ${match[2]}`);
			continue;
		}
		if (values.has(match[1]!)) throw new Error(`duplicate metadata field: ${match[1]}`);
		values.set(match[1]!, match[2]!);
	}
	if (!versionSeen) throw new Error("incomplete durable metadata envelope: missing version");
	const id = values.get("id");
	const semantic = values.get("semanticDigest");
	const parseUuidArray = (name: string): string[] => {
		const raw = values.get(name) ?? "[]";
		if (!/^\[(?:[0-9a-f-]{36}(?:, [0-9a-f-]{36})*)?\]$/.test(raw)) throw new Error(`${name} must be a simple UUID array`);
		const result = raw === "[]" ? [] : raw.slice(1, -1).split(", ");
		for (const value of result) assertUuid(value, `${name} entry`);
		if (new Set(result).size !== result.length) throw new Error(`${name} contains duplicates`);
		return result;
	};
	if (!id || !semantic || !DIGEST.test(semantic)) throw new Error("incomplete durable metadata envelope");
	assertUuid(id, "id");
	return { id, semanticDigest: semantic, supersedes: parseUuidArray("supersedes"), supersededBy: parseUuidArray("supersededBy") };
}

function parseMadrMetadata(lines: string[], bounds: FrontmatterBounds): MadrMetadata & { lifecycle: DurableLifecycle } {
	const topLevel = lines.slice(1, bounds.end);
	const scalar = (key: string): string | undefined => {
		const matches = topLevel.flatMap((line) => {
			const match = new RegExp(`^${key}:\\s*(.*)$`).exec(line);
			return match === null ? [] : [match[1]!];
		});
		if (matches.length > 1) throw new Error(`duplicate MADR metadata field: ${key}`);
		return matches[0];
	};
	const status = scalar("status");
	if (!status) throw new Error("durable import requires top-level MADR status");
	const date = scalar("date");
	if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("MADR date must use YYYY-MM-DD");
	const list = (key: string): string[] | undefined => {
		const starts = topLevel.flatMap((line, index) => line === `${key}:` ? [index] : []);
		if (starts.length > 1) throw new Error(`duplicate MADR metadata field: ${key}`);
		if (starts.length === 0) return undefined;
		const values: string[] = [];
		for (const line of topLevel.slice(starts[0]! + 1)) {
			if (/^[^\s]/.test(line)) break;
			if (line === "") continue;
			const match = /^  - (.+)$/.exec(line);
			if (!match) throw new Error(`unsupported MADR ${key} list`);
			values.push(match[1]!);
		}
		return values;
	};
	return {
		lifecycle: lifecycleForStatus(status),
		...(date === undefined ? {} : { date }),
		...(list("decision-makers") === undefined ? {} : { decisionMakers: list("decision-makers")! }),
		...(list("consulted") === undefined ? {} : { consulted: list("consulted")! }),
		...(list("informed") === undefined ? {} : { informed: list("informed")! }),
	};
}

const SECTION_HEADINGS = {
	context: "## Context and Problem Statement",
	optionsConsidered: "## Considered Options",
	decision: "## Decision Outcome",
	consequences: "### Consequences",
} as const;

function assertBalancedFences(lines: string[]): void {
	let fenced = false;
	for (const line of lines) if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
	if (fenced) throw new Error("ambiguous durable document: unclosed fenced region");
}

function headingLevel(line: string): number | undefined {
	const match = /^(#{1,6})\s+/.exec(line);
	return match?.[1].length;
}

function sectionBounds(lines: string[], heading: string, ignored: Set<number>): { start: number; end: number } | undefined {
	const matches: number[] = [];
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(```|~~~)/.test(lines[i]!)) fenced = !fenced;
		if (!fenced && !ignored.has(i) && lines[i] === heading) matches.push(i);
	}
	if (matches.length > 1) throw new Error(`ambiguous durable section: ${heading}`);
	if (matches.length === 0) return undefined;
	const start = matches[0]!;
	const level = headingLevel(heading)!;
	let end = lines.length;
	let fencedAtEnd = false;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^\s*(```|~~~)/.test(lines[i]!)) fencedAtEnd = !fencedAtEnd;
		if (!fencedAtEnd && (headingLevel(lines[i]!) ?? 99) <= level) { end = i; break; }
	}
	return { start, end };
}

function readSection(lines: string[], bounds: { start: number; end: number }): string[] {
	const content = lines.slice(bounds.start + 1, bounds.end);
	while (content[0] === "") content.shift();
	while (content.at(-1) === "") content.pop();
	return content.length === 0 ? [] : content;
}

function renderMarkdownList(values: string[]): string {
	return values.flatMap((value) => {
		const [first = "", ...rest] = normalizeLineEndings(value).split("\n");
		return [`- ${first}`, ...rest.map((line) => `  ${line}`)];
	}).join("\n");
}

function parseMarkdownList(lines: string[]): string[] {
	const values: string[] = [];
	for (const line of lines) {
		if (line.startsWith("- ")) values.push(line.slice(2));
		else if (/^  /.test(line) && values.length > 0) values[values.length - 1] += `\n${line.slice(2)}`;
		else if (line !== "") throw new Error("unsupported list content in recognized section");
	}
	return values;
}

function renderBody(fields: DurableAdrFields): string[] {
	return [
		`# ${normalizeLineEndings(fields.title)}`, "",
		SECTION_HEADINGS.context, "", normalizeLineEndings(fields.context), "",
		SECTION_HEADINGS.optionsConsidered, "", renderMarkdownList(fields.optionsConsidered), "",
		SECTION_HEADINGS.decision, "", normalizeLineEndings(fields.decision), "",
		SECTION_HEADINGS.consequences, "", normalizeLineEndings(fields.consequences),
	];
}

interface EnvelopeData {
	id: string;
	semanticDigest: string;
	supersedes: string[];
	supersededBy: string[];
}

function renderEnvelope(adr: EnvelopeData): string[] {
	return [ENVELOPE_KEY, "  version: 1", `  id: ${adr.id}`, `  semanticDigest: ${adr.semanticDigest}`, `  supersedes: [${[...adr.supersedes].sort().join(", ")}]`, `  supersededBy: [${[...adr.supersededBy].sort().join(", ")}]`];
}

function validateMadrMetadata(metadata: MadrMetadata): void {
	if (metadata.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(metadata.date)) throw new Error("MADR date must use YYYY-MM-DD");
	for (const [name, values] of [["decision-makers", metadata.decisionMakers], ["consulted", metadata.consulted], ["informed", metadata.informed]] as const) {
		if (values === undefined) continue;
		if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value))) throw new Error(`MADR ${name} must be a list of non-empty single-line strings`);
	}
}

function renderFrontmatter(metadata: MadrMetadata & { lifecycle: DurableLifecycle }, envelope: EnvelopeData): string[] {
	validateMadrMetadata(metadata);
	const lines = [`status: ${statusForLifecycle(metadata.lifecycle)}`];
	if (metadata.date !== undefined) lines.push(`date: ${metadata.date}`);
	for (const [key, values] of [["decision-makers", metadata.decisionMakers], ["consulted", metadata.consulted], ["informed", metadata.informed]] as const) {
		if (values === undefined) continue;
		lines.push(`${key}:`, ...values.map((value) => `  - ${value}`));
	}
	return [...lines, ...renderEnvelope(envelope)];
}

type CreateDurableAdrInput = Omit<DurableAdrFields, "supersedes"> & MadrMetadata & { supersedes?: string[]; id?: string; lifecycle?: DurableLifecycle };

export function createDurableAdr(input: CreateDurableAdrInput): DurableAdr {
	const { id = randomUUID(), lifecycle = "draft", date, decisionMakers, consulted, informed, supersedes = [], ...body } = input;
	const fields: DurableAdrFields = { ...body, supersedes: [...supersedes] };
	validateFields(fields);
	validateMadrMetadata({ date, decisionMakers, consulted, informed });
	assertUuid(id, "id");
	assertLifecycle(lifecycle);
	const envelope = { id, semanticDigest: semanticDigest(fields), supersedes: fields.supersedes, supersededBy: [] };
	const source = [FRONTMATTER_DELIMITER, ...renderFrontmatter({ lifecycle, date, decisionMakers, consulted, informed }, envelope), FRONTMATTER_DELIMITER, "", ...renderBody(fields)].join("\n") + "\n";
	return importDurableAdr(source);
}

/** Parse the recognized ADR sections out of a body that carries no envelope. */
function parseBodyFields(body: string[], supersedes: string[]): DurableAdrFields {
	let inFence = false;
	let titleLine: string | undefined;
	for (const line of body) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		else if (!inFence && /^\uFEFF?#\s+/.test(line)) { titleLine = line; break; }
	}
	if (!titleLine) throw new Error("durable import requires a level-one title");
	const fields: DurableAdrFields = { title: titleLine.replace(/^\uFEFF?#\s+/, ""), context: "", optionsConsidered: [], decision: "", consequences: "", supersedes };
	const sections = new Map<keyof typeof SECTION_HEADINGS, { start: number; end: number }>();
	for (const key of Object.keys(SECTION_HEADINGS) as (keyof typeof SECTION_HEADINGS)[]) {
		const section = sectionBounds(body, SECTION_HEADINGS[key], new Set());
		if (!section) throw new Error(`durable import requires recognized section: ${SECTION_HEADINGS[key]}`);
		sections.set(key, section);
	}
	const decision = sections.get("decision")!;
	const consequences = sections.get("consequences")!;
	if (consequences.start <= decision.start || consequences.start >= decision.end) throw new Error("Consequences must be nested under Decision Outcome");
	decision.end = consequences.start;
	for (const key of Object.keys(SECTION_HEADINGS) as (keyof typeof SECTION_HEADINGS)[]) {
		const values = readSection(body, sections.get(key)!);
		if (key === "optionsConsidered") fields[key] = parseMarkdownList(values);
		else fields[key] = values.join("\n") as never;
	}
	validateFields(fields);
	return fields;
}

/** The envelope-free document shape a human reviews before an ADR exists. */
export function renderDurableAdrBody(fields: DurableAdrFields): string {
	validateFields(fields);
	return `${renderBody(fields).join("\n")}\n`;
}

/**
 * Build a draft ADR whose body is exactly the reviewed text. The reviewed body
 * is the only input to validation, the semantic digest and the written source;
 * only line endings and a leading BOM are normalized.
 */
export function createDurableAdrFromBody(body: string, input: { id?: string; supersedes?: string[]; metadata?: MadrMetadata } = {}): DurableAdr {
	const id = input.id ?? randomUUID();
	assertUuid(id, "id");
	const supersedes = [...(input.supersedes ?? [])];
	const { lines, fields } = parseReviewedBody(body, supersedes);
	const envelope = { id, semanticDigest: semanticDigest(fields), supersedes, supersededBy: [] };
	const source = [FRONTMATTER_DELIMITER, ...renderFrontmatter({ lifecycle: "draft", ...(input.metadata ?? {}) }, envelope), FRONTMATTER_DELIMITER, "", ...lines].join("\n");
	return importDurableAdr(source);
}

function parseReviewedBody(body: string, supersedes: string[]): { lines: string[]; fields: DurableAdrFields } {
	assertString(body, "body");
	const { lines } = splitLines(body);
	assertBalancedFences(lines);
	if (lines[0] === FRONTMATTER_DELIMITER) throw new Error("reviewed body must not start with its own frontmatter delimiter");
	return { lines, fields: parseBodyFields(lines, supersedes) };
}

/**
 * Validate an envelope-free ADR body without assigning an identity. Nothing
 * is created or written.
 */
export function validateDurableAdrBody(body: string): DurableAdrFields {
	return parseReviewedBody(body, []).fields;
}

/**
 * The editable, envelope-free body of an ADR source: everything after the
 * frontmatter, minus one blank separator line. Line endings are normalized.
 */
export function durableAdrBody(source: string): string {
	importDurableAdr(source);
	const { lines } = splitLines(source);
	const body = lines.slice(frontmatterBounds(lines).end + 1);
	if (body[0] === "") body.shift();
	return body.join("\n");
}

/**
 * Replace the body of a draft with exactly the reviewed text. The frontmatter
 * bytes are preserved except the owned semanticDigest, the separator and
 * the source line-ending style are kept, and the result must reimport.
 */
export function replaceDurableAdrBody(source: string, reviewedBody: string): string {
	const current = importDurableAdr(source);
	if (current.lifecycle !== "draft") throw new Error(`only a draft ADR can be edited; ${current.id} is ${current.lifecycle}`);
	const lineEndingKinds = new Set([...source.matchAll(/\r\n|\r|\n/g)].map((match) => match[0]));
	if (lineEndingKinds.size > 1) throw new Error("cannot safely update mixed line endings without changing untouched bytes");
	const { lines: reviewedLines, fields } = parseReviewedBody(reviewedBody, current.supersedes);
	const { lines, newline, bom } = splitLines(source);
	const bounds = frontmatterBounds(lines);
	const separator = lines[bounds.end + 1] === "" ? [""] : [];
	const frontmatter = lines.slice(bounds.start, bounds.end + 1);
	const digest = semanticDigest(fields);
	if (digest !== current.semanticDigest) {
		const index = frontmatter.findIndex((line, i) => i > bounds.envelopeStart && i < bounds.envelopeEnd && line.startsWith("  semanticDigest:"));
		frontmatter[index] = `  semanticDigest: ${digest}`;
	}
	const output = (bom ? "\uFEFF" : "") + [...frontmatter, ...separator, ...reviewedLines].join(newline);
	importDurableAdr(output);
	return output;
}

export function importDurableAdr(source: string): DurableAdr {
	assertString(source, "source");
	const { lines } = splitLines(source);
	assertBalancedFences(lines);
	const bounds = frontmatterBounds(lines);
	const envelope = parseEnvelope(lines, bounds);
	const madr = parseMadrMetadata(lines, bounds);
	const fields = parseBodyFields(lines.slice(bounds.end + 1), envelope.supersedes);
	if (envelope.supersedes.includes(envelope.id) || envelope.supersededBy.includes(envelope.id)) throw new Error("ADR cannot supersede itself");
	const computed = semanticDigest(fields);
	if (computed !== envelope.semanticDigest) throw new Error(`semantic digest mismatch: declared ${envelope.semanticDigest}, computed ${computed}`);
	return { ...fields, ...madr, ...envelope, sourceFingerprint: sourceFingerprint(source), source };
}

export function updateDurableAdr(source: string, patch: DurableAdrPatch): string {
	const current = importDurableAdr(source);
	const substantive = Object.keys(patch).some((key) => !["lifecycle", "supersededBy"].includes(key));
	if (patch.lifecycle !== undefined) assertLifecycle(patch.lifecycle);
	if ((current.lifecycle === "accepted" || current.lifecycle === "superseded") && substantive) throw new Error("accepted ADRs are immutable; create a successor");
	if (current.lifecycle === "accepted" && patch.lifecycle !== undefined && patch.lifecycle !== "accepted" && patch.lifecycle !== "superseded") {
		throw new Error("accepted ADR lifecycle may only remain accepted or become superseded");
	}
	if (current.lifecycle === "superseded" && patch.lifecycle !== undefined && patch.lifecycle !== "superseded") {
		throw new Error("superseded ADR lifecycle cannot be reverted");
	}
	const next: DurableAdrFields = {
		title: patch.title ?? current.title,
		context: patch.context ?? current.context,
		optionsConsidered: patch.optionsConsidered ?? current.optionsConsidered,
		decision: patch.decision ?? current.decision,
		consequences: patch.consequences ?? current.consequences,
		supersedes: patch.supersedes ?? current.supersedes,
	};
	validateFields(next);
	const supersededBy = patch.supersededBy ?? current.supersededBy;
	for (const id of supersededBy) {
		assertUuid(id, "supersededBy entry");
		if (id === current.id) throw new Error("ADR cannot supersede itself");
	}
	if (new Set(supersededBy).size !== supersededBy.length) throw new Error("supersededBy contains duplicates");
	const metadata = { id: current.id, lifecycle: patch.lifecycle ?? current.lifecycle, semanticDigest: semanticDigest(next), supersedes: next.supersedes, supersededBy };
	return rewriteSource(source, current, next, metadata, patch);
}

function valueLines(value: string): string[] {
	return normalizeLineEndings(value).split("\n");
}

function rewriteSource(source: string, current: DurableAdr, next: DurableAdrFields, metadata: EnvelopeData & { lifecycle: DurableLifecycle }, patch: DurableAdrPatch): string {
	const lineEndingKinds = new Set([...source.matchAll(/\r\n|\r|\n/g)].map((match) => match[0]));
	if (lineEndingKinds.size > 1) throw new Error("cannot safely update mixed line endings without changing untouched bytes");
	const { lines, newline, bom, finalNewline } = splitLines(source);
	const bounds = frontmatterBounds(lines);
	let body = lines.slice(bounds.end + 1);
	const replacements: Array<{ start: number; end: number; lines: string[] }> = [];
	for (const key of Object.keys(SECTION_HEADINGS) as (keyof typeof SECTION_HEADINGS)[]) {
		if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
		const section = sectionBounds(body, SECTION_HEADINGS[key], new Set());
		if (!section) throw new Error(`cannot safely update missing recognized section: ${SECTION_HEADINGS[key]}`);
		if (key === "decision") {
			const consequences = sectionBounds(body, SECTION_HEADINGS.consequences, new Set());
			if (!consequences || consequences.start <= section.start || consequences.start >= section.end) throw new Error("cannot safely update Decision Outcome without nested Consequences");
			section.end = consequences.start;
		}
		const values = key === "optionsConsidered"
			? next[key].flatMap((value) => {
				const [first = "", ...rest] = valueLines(value);
				return [`- ${first}`, ...rest.map((line) => `  ${line}`)];
			})
			: valueLines(next[key]);
		replacements.push({ start: section.start + 1, end: section.end, lines: ["", ...values, ""] });
	}
	for (const replacement of replacements.sort((a, b) => b.start - a.start)) body = body.slice(0, replacement.start).concat(replacement.lines, body.slice(replacement.end));
	if (Object.prototype.hasOwnProperty.call(patch, "title")) {
		let fenced = false;
		const titleIndex = body.findIndex((line) => {
			if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return false; }
			return !fenced && /^#\s+/.test(line);
		});
		if (titleIndex < 0) throw new Error("cannot safely update title");
		body[titleIndex] = `# ${normalizeLineEndings(next.title)}`;
	}
	const frontmatter = lines.slice(bounds.start, bounds.end + 1);
	const ownedStart = bounds.envelopeStart - bounds.start;
	const ownedEnd = bounds.envelopeEnd - bounds.start;
	const envelope = frontmatter.slice(ownedStart, ownedEnd);
	for (const field of ["semanticDigest", "supersedes", "supersededBy"] as const) {
		const before = current[field];
		const after = metadata[field];
		if (JSON.stringify(before) === JSON.stringify(after)) continue;
		const replacement = renderEnvelope(metadata).find((line) => line.startsWith(`  ${field}:`))!;
		const index = envelope.findIndex((line) => line.startsWith(`  ${field}:`));
		if (index < 0) envelope.push(replacement);
		else envelope[index] = replacement;
	}
	const rewrittenFrontmatter = frontmatter.slice(0, ownedStart).concat(envelope, frontmatter.slice(ownedEnd));
	if (metadata.lifecycle !== current.lifecycle) {
		const statusIndices = rewrittenFrontmatter.flatMap((line, index) => /^status:/.test(line) ? [index] : []);
		if (statusIndices.length !== 1) throw new Error("cannot safely update missing or duplicate MADR status");
		rewrittenFrontmatter[statusIndices[0]!] = `status: ${statusForLifecycle(metadata.lifecycle)}`;
	}
	let output = (bom ? "\uFEFF" : "") + rewrittenFrontmatter.concat(body).join(newline);
	while (!finalNewline && output.endsWith(newline)) output = output.slice(0, -newline.length);
	// Reparse the candidate so edits that make headings/fences ambiguous are
	// refused instead of producing a document that cannot be safely imported.
	importDurableAdr(output);
	return output;
}

export function createSuccessorAdr(predecessor: DurableAdr, patch: Omit<DurableAdrFields, "supersedes"> & { supersedes?: string[] }): DurableAdr {
	if (predecessor.lifecycle !== "accepted") throw new Error("only an accepted ADR can have a substantive successor");
	return createDurableAdr({ ...patch, supersedes: [...new Set([predecessor.id, ...(patch.supersedes ?? [])])] });
}

export function validateDurableRecordSet(records: Iterable<Pick<DurableAdr, "id" | "supersedes" | "supersededBy">>): void {
	const values = [...records];
	const byId = new Map<string, Pick<DurableAdr, "id" | "supersedes" | "supersededBy">>();
	for (const record of values) {
		assertUuid(record.id, "id");
		if (byId.has(record.id)) throw new Error(`duplicate durable ID: ${record.id}`);
		byId.set(record.id, record);
	}
	for (const record of values) {
		if (!Array.isArray(record.supersedes) || !Array.isArray(record.supersededBy)) throw new Error(`invalid supersession lists in ${record.id}`);
		for (const id of [...record.supersedes, ...record.supersededBy]) assertUuid(id, "supersession entry");
		if (new Set(record.supersedes).size !== record.supersedes.length) throw new Error(`duplicate supersedes ID in ${record.id}`);
		if (new Set(record.supersededBy).size !== record.supersededBy.length) throw new Error(`duplicate supersededBy ID in ${record.id}`);
		for (const id of record.supersedes) {
			if (id === record.id) throw new Error(`durable record ${record.id} self-references`);
			if (!byId.has(id)) throw new Error(`unknown superseded ID: ${id}`);
		}
		for (const id of record.supersededBy) {
			if (id === record.id) throw new Error(`durable record ${record.id} self-references`);
			if (!byId.has(id)) throw new Error(`unknown supersededBy ID: ${id}`);
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) throw new Error("supersession cycle detected");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const predecessor of byId.get(id)!.supersedes) visit(predecessor);
		visiting.delete(id); visited.add(id);
	};
	for (const id of byId.keys()) visit(id);
}
