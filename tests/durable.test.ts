import { describe, expect, it } from "vitest";
import {
	createDurableAdr,
	createDurableAdrFromBody,
	createSuccessorAdr,
	importDurableAdr,
	renderDurableAdrBody,
	semanticDigest,
	updateDurableAdr,
	validateDurableRecordSet,
} from "../src/durable.ts";

const id = "123e4567-e89b-42d3-a456-426614174000";
const id2 = "123e4567-e89b-42d3-a456-426614174001";

const fields = {
	title: "Choose storage",
	context: "We need durable storage. The application is local-first.",
	optionsConsidered: ["SQLite", "JSON"],
	decision: "Use SQLite.",
	consequences: "A migration path is required.",
};

describe("durable ADR core", () => {
	it("refuses unpaired surrogates rather than silently replacing them on disk", () => {
		expect(() => createDurableAdr({ ...fields, title: "bad\ud800" })).toThrow("valid Unicode");
		const source = createDurableAdr({ ...fields, id }).source;
		expect(() => importDurableAdr(source + "\udfff")).toThrow("valid Unicode");
		expect(() => updateDurableAdr(source, { optionsConsidered: ["bad\ud800"] })).toThrow("valid Unicode");
	});

	it("accepts by changing only lifecycle bytes and leaves manual acceptance byte-identical", () => {
		const source = createDurableAdr({ ...fields, id }).source
			.replace("  id:", "\n  id:")
			.replace("  supersededBy: []\n", "");
		const accepted = updateDurableAdr(source, { lifecycle: "accepted" });
		expect(accepted).toBe(source.replace("status: proposed", "status: accepted"));
		expect(updateDurableAdr(accepted, { lifecycle: "accepted" })).toBe(accepted);
	});

	it("refuses self backlinks and substantive edits of superseded records", () => {
		const source = createDurableAdr({ ...fields, id }).source;
		expect(() => importDurableAdr(source.replace("supersededBy: []", `supersededBy: [${id}]`))).toThrow("supersede itself");
		expect(() => updateDurableAdr(updateDurableAdr(source, { lifecycle: "superseded" }), { decision: "Changed" })).toThrow("immutable");
	});

	it("preserves absent final newline when replacing the final recognized section", () => {
		const source = createDurableAdr({ ...fields, id }).source.trimEnd();
		for (const consequences of ["New consequence", ""]) {
			const updated = updateDurableAdr(source, { consequences });
			expect(updated.endsWith("\n")).toBe(false);
			expect(importDurableAdr(updated).consequences).toBe(consequences);
		}
	});

	it("updates the actual title rather than an opaque fenced heading", () => {
		const source = createDurableAdr({ ...fields, id }).source.replace("# Choose storage", "```md\n# Example title\n```\n\n# Choose storage");
		const updated = updateDurableAdr(source, { title: "Actual new title" });
		expect(updated).toContain("```md\n# Example title\n```");
		expect(importDurableAdr(updated).title).toBe("Actual new title");
	});

	it("generates the MADR 4.0 bare-minimal body and round-trips its digest", () => {
		const adr = createDurableAdr({ ...fields, id });
		expect(adr.source).toContain("status: proposed\n");
		expect(adr.source).not.toContain("  lifecycle:");
		expect(adr.source).toContain("x-pi-decision-ledger:");
		expect(adr.source).toContain("## Context and Problem Statement");
		expect(adr.source).toContain("## Considered Options");
		expect(adr.source).toContain("## Decision Outcome");
		expect(adr.source).toContain("### Consequences");
		expect(adr.source).not.toContain("Decision Drivers");
		expect(adr.source).not.toContain("Follow-ups");
		expect(adr.semanticDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(importDurableAdr(adr.source)).toMatchObject({ ...fields, id, lifecycle: "draft", semanticDigest: adr.semanticDigest });
		expect(semanticDigest({ ...fields, supersedes: [] })).toBe(adr.semanticDigest);
		expect(adr.semanticDigest).toBe("sha256:943352b27265a661a135c9306063f8eaedb3b56080a90850fc1280a75ccc3812");
	});

	it("uses official optional MADR frontmatter only when values are known", () => {
		const adr = createDurableAdr({
			...fields,
			id,
			date: "2026-09-23",
			decisionMakers: ["Fridtjof"],
			consulted: ["Platform team"],
		});
		expect(adr.source).toContain("date: 2026-09-23\ndecision-makers:\n  - Fridtjof\nconsulted:\n  - Platform team\n");
		expect(adr.source).not.toContain("informed:");
		expect(importDurableAdr(adr.source)).toMatchObject({ date: "2026-09-23", decisionMakers: ["Fridtjof"], consulted: ["Platform team"] });
		expect(() => createDurableAdr({ ...fields, date: "23-09-2026" })).toThrow("YYYY-MM-DD");
	});

	it("keeps the exact imported source separate from semantic identity", () => {
		const source = createDurableAdr({ ...fields, id }).source.replace("---\n\n# Choose storage", "---\n\n<!-- opaque -->\n\n# Choose storage");
		const imported = importDurableAdr(source);
		expect(imported.source).toBe(source);
		expect(imported.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(imported.semanticDigest).toBe(semanticDigest({ ...fields, supersedes: [] }));
	});

	it("preserves a UTF-8 BOM and exact body bytes for metadata-only updates", () => {
		const source = `\uFEFF${createDurableAdr({ ...fields, id }).source}`;
		const bodyBefore = source.slice(source.indexOf("\n---\n") + 5);
		const updated = updateDurableAdr(source, { lifecycle: "accepted" });
		expect(updated.startsWith("\uFEFF")).toBe(true);
		expect(updated.slice(updated.indexOf("\n---\n") + 5)).toBe(bodyBefore);
		expect(importDurableAdr(updated).title).toBe(fields.title);
	});

	it("refuses to rewrite mixed line endings rather than changing opaque bytes", () => {
		const source = createDurableAdr({ ...fields, id }).source;
		const mixed = source.replace("### Consequences\n", "### Consequences\r\n");
		expect(importDurableAdr(mixed).id).toBe(id);
		expect(() => updateDurableAdr(mixed, { lifecycle: "accepted" })).toThrow("mixed line endings");
	});

	it("preserves opaque YAML and Markdown regions and original line endings while updating owned regions", () => {
		const adr = createDurableAdr({ ...fields, id });
		const source = adr.source.replace("x-pi-decision-ledger:", "# retained comment\nx-company: &company\n  owner: platform\nx-company-alias: *company\nx-pi-decision-ledger:")
			.replace("## Considered Options", "## Security review\n\nkeep this byte-for-byte\n\n## Considered Options")
			.replaceAll("\n", "\r\n");
		const updated = updateDurableAdr(source, { decision: "Use an embedded database." });
		expect(updated).toContain("# retained comment\r\nx-company: &company\r\n  owner: platform\r\nx-company-alias: *company\r\n");
		expect(updated).toContain("## Security review\r\n\r\nkeep this byte-for-byte\r\n");
		expect(updated).toContain("Use an embedded database.");
		expect(updated.endsWith("\r\n")).toBe(true);
		expect(importDurableAdr(updated).decision).toBe("Use an embedded database.");
	});

	it("ignores heading-like text in fences and refuses unclosed fences", () => {
		const adr = createDurableAdr({ ...fields, id });
		const source = adr.source + "\n## Appendix\n\n```md\n## Context and Problem Statement\n```\n";
		expect(importDurableAdr(source)).toBeTruthy();
		expect(() => importDurableAdr(adr.source.replace("## Context and Problem Statement", "```md\n## Context and Problem Statement"))).toThrow("unclosed fenced");
	});

	it("refuses duplicate metadata and digest tampering", () => {
		const adr = createDurableAdr({ ...fields, id });
		expect(() => importDurableAdr(adr.source.replace("x-pi-decision-ledger:", "x-pi-decision-ledger:\n  version: 1\nx-pi-decision-ledger:"))).toThrow("duplicate");
		expect(() => importDurableAdr(adr.source.replace("Use SQLite.", "Use Postgres."))).toThrow("digest mismatch");
	});

	it("refuses unsafe updates and keeps accepted metadata boundaries narrow", () => {
		const accepted = createDurableAdr({ ...fields, id, lifecycle: "accepted" });
		expect(() => updateDurableAdr(accepted.source, { decision: "Use Postgres." })).toThrow("immutable");
		expect(() => updateDurableAdr(accepted.source, { lifecycle: "draft" })).toThrow("only remain accepted or become superseded");
		const draft = createDurableAdr({ ...fields, id });
		expect(() => updateDurableAdr(draft.source.replace("### Consequences", "## Notes"), { consequences: "Changed" })).toThrow("recognized section");
	});

	it("keeps accepted records immutable and gives successors new identity", () => {
		const accepted = createDurableAdr({ ...fields, id, lifecycle: "accepted" });
		expect(() => updateDurableAdr(accepted.source, { decision: "Use Postgres." })).toThrow("immutable");
		const successor = createSuccessorAdr(accepted, { ...fields, title: "Choose storage v2", decision: "Use Postgres." });
		expect(successor.id).not.toBe(id);
		expect(successor.supersedes).toEqual([id]);
		expect(importDurableAdr(successor.source).supersedes).toEqual([id]);
	});

	it("builds a draft from reviewed body text, keeping it verbatim below the envelope", () => {
		const body = renderDurableAdrBody({ ...fields, supersedes: [] }).replace("Use SQLite.", "Use SQLite, as reviewed.");
		const adr = createDurableAdrFromBody(body, { id });
		expect(adr.id).toBe(id);
		expect(adr.lifecycle).toBe("draft");
		expect(adr.decision).toBe("Use SQLite, as reviewed.");
		expect(adr.source.endsWith(body)).toBe(true);
		expect(importDurableAdr(adr.source).semanticDigest).toBe(adr.semanticDigest);
	});

	it("does not add a final newline that the reviewer did not provide", () => {
		const body = renderDurableAdrBody({ ...fields, supersedes: [] }).trimEnd();
		const adr = createDurableAdrFromBody(body, { id });
		expect(adr.source.endsWith(body)).toBe(true);
		expect(adr.source.endsWith("\n")).toBe(false);
	});

	it("refuses reviewed bodies it cannot validate, and gives each one a fresh identity", () => {
		const body = renderDurableAdrBody({ ...fields, supersedes: [] });
		expect(() => createDurableAdrFromBody("# Only a title\n")).toThrow("recognized section");
		expect(() => createDurableAdrFromBody(body.replace("# Choose storage", "Choose storage"))).toThrow("level-one title");
		expect(() => createDurableAdrFromBody(`---\n${body}`)).toThrow("frontmatter");
		expect(createDurableAdrFromBody(body).id).not.toBe(createDurableAdrFromBody(body).id);
	});

	it("rejects non-canonical durable IDs", () => {
		expect(() => createDurableAdr({ ...fields, id: id.toUpperCase() })).toThrow("lowercase UUIDv4");
	});

	it("validates duplicate, unknown, self-referential, and cyclic record sets", () => {
		const base = { id, supersedes: [], supersededBy: [] };
		expect(() => validateDurableRecordSet([base, base])).toThrow("duplicate");
		expect(() => validateDurableRecordSet([{ ...base, supersedes: [id2] }])).toThrow("unknown");
		expect(() => validateDurableRecordSet([{ ...base, supersedes: [id] }])).toThrow("self");
		expect(() => validateDurableRecordSet([{ ...base, supersedes: [id2] }, { id: id2, supersedes: [id], supersededBy: [] }])).toThrow("cycle");
	});
});
