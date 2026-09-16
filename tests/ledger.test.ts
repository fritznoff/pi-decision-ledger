import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import decisionLedgerExtension from "../extensions/index.ts";
import { matchesKey, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
	DECISION_COMMANDS,
	DECISION_EXPORT_MESSAGE_TYPE,
	DECISION_ID_ALPHABET,
	FOCUS_MARKER_MESSAGE_TYPE,
	FOCUS_TRANSITION_MESSAGE_TYPE,
	REVIEW_DRAFT_MESSAGE_TYPE,
	MAX_DECISION_ID_ATTEMPTS,
	addDecisionItems,
	applyBatchUpdates,
	applyDecisionAction,
	decisionActionReason,
	decisionProgress,
	isDecisionCompleted,
	LIFECYCLES,
	boundLedgerOutput,
	cloneState,
	collectDecisionIds,
	completeDecisionCommandArguments,
	completeDecisionsCommandArguments,
	conciseDecisionPoint,
	decisionDisplayTitle,
	decisionExportDelivery,
	decisionOverviewDelivery,
	decisionStatePresentation,
	emptyLedgerState,
	exitExploration,
	findNaturalLanguageExplorationReturnEntryId,
	findNewestOffBranchSnapshot,
	formatDecisionDetail,
	formatDecisionExport,
	formatDecisionId,
	formatDecisionIdForTui,
	formatDecisionOverview,
	formatLedgerMarkdown,
	formatReturnReceipt,
	generateDecisionId,
	getFocusedExploration,
	getDecisionProposal,
	isDecisionId,
	parseDecisionRecordMarkdown,
	proposeDecisionRecord,
	removeDecisionItems,
	orderDecisionItems,
	orderActionableDecisionItems,
	replayLedgerBranch,
	resolveDecisionRecord,
	renderDecisionRecordMarkdown,
	startExploration,
	switchExploration,
	type AddDecisionItemInput,
	type DecisionRecord,
	type LedgerState,
} from "../src/ledger.ts";
import { DecisionWidget } from "../src/presentation.ts";

const record: DecisionRecord = {
	decision: "Use the narrow API.",
	context: "The existing caller only needs the narrow API.",
	optionsConsidered: ["Narrow API", "Broad API"],
	consequences: "The broad API remains a future option.",
	followUps: ["Add an integration test."],
};

function byteIndex(character: string): number {
	return DECISION_ID_ALPHABET.indexOf(character);
}

function randomBytesForIds(...ids: string[]): (size: number) => Uint8Array {
	const bytes = ids.flatMap((id) => [...id].map(byteIndex));
	let index = 0;
	return () => Uint8Array.of(bytes[index++] ?? 0);
}

function stateWithItems(...ids: string[]): LedgerState {
	return {
		ledger: {
			items: ids.map((id, index) => ({ id, point: `Point ${index + 1}`, lifecycle: "open" as const })),
			nextId: 1,
		},
	};
}

function toolEntry(id: string, state: LedgerState): object {
	return {
		type: "message",
		id,
		message: {
			role: "toolResult",
			toolName: "decision_ledger",
			details: { state },
		},
	};
}

function messageEntry(id: string, role: "user" | "assistant"): object {
	return {
		type: "message",
		id,
		message: { role },
	};
}

function customEntry(id: string, state: LedgerState): object {
	return {
		type: "custom",
		id,
		customType: "pi-decision-ledger",
		data: { extension: "pi-decision-ledger", version: 1, source: "command", state },
	};
}

function forkResetEntry(id: string): object {
	return {
		type: "custom",
		id,
		customType: "pi-decision-ledger",
		data: { extension: "pi-decision-ledger", version: 1, source: "fork_reset", state: {} },
	};
}

describe("decision IDs and state transitions", () => {
	it("allocates random uppercase three-character IDs and keeps the legacy counter only for compatibility", () => {
		const initial = addDecisionItems(emptyLedgerState(), [{ point: "Choose A or B" }, { point: "Confirm rollout" }], {
			randomBytes: randomBytesForIds("ABC", "XYZ"),
		});

		expect(initial.ledger?.items.map((item) => item.id)).toEqual(["ABC", "XYZ"]);
		expect(initial.ledger?.nextId).toBeUndefined();
		expect(initial.ledger?.usedIds).toEqual(["ABC", "XYZ"]);
		expect(isDecisionId("ABC")).toBe(true);
		expect(isDecisionId("D27")).toBe(true);
		expect(isDecisionId("D1")).toBe(true);
		expect(isDecisionId("AB")).toBe(false);
	});

	it("retries ID collisions and fails after a bounded number of attempts", () => {
		const collisionThenFree = generateDecisionId(new Set(["ABC"]), randomBytesForIds("ABC", "XYZ"));
		expect(collisionThenFree).toBe("XYZ");

		expect(() => generateDecisionId(new Set(["ABC"]), randomBytesForIds("ABC", "ABC"), 2)).toThrow(
		"could not allocate a unique decision ID after 2 attempts",
	);
		expect(MAX_DECISION_ID_ATTEMPTS).toBeGreaterThan(0);
	});

	it("applies updates atomically without assuming a sequential ID format", () => {
		const initial = stateWithItems("ABC", "XYZ");
		const updated = applyBatchUpdates(initial, [
			{ id: "abc", lifecycle: "resolved", record },
			{ id: "XYZ", lifecycle: "deferred" },
		]);

		expect(updated.ledger?.items.map((item) => [item.id, item.lifecycle])).toEqual([
			["ABC", "resolved"],
			["XYZ", "deferred"],
		]);

		expect(() => applyBatchUpdates(updated, [{ id: "ABC", lifecycle: "open" }, { id: "ZZZ", lifecycle: "resolved" }])).toThrow(
		"`ZZZ` was not found in the current ledger",
	);
		expect(updated.ledger?.items[0]?.lifecycle).toBe("resolved");
	});

	it("keeps explored proposal finalization separate from ordinary updates", () => {
		const open = stateWithItems("ABC", "XYZ");
		const exploring = startExploration(open, "ABC", "entry-1", "decision-return-ABC");
		expect(exploring.ledger?.items[0]?.lifecycle).toBe("exploring");
		expect(() => applyBatchUpdates(exploring, [{ id: "ABC", lifecycle: "exploring" }])).toThrow(
		"must be started with /decision explore",
	);
		expect(() => applyBatchUpdates(exploring, [{ id: "ABC", lifecycle: "proposed" }])).toThrow(
		"must be proposed with decision_ledger propose",
	);
		expect(() => applyBatchUpdates(exploring, [{ id: "ABC", lifecycle: "resolved" }])).toThrow(
		"must be finalized with /decision return",
	);

		const markdown = renderDecisionRecordMarkdown(exploring.ledger!.items[0]!, record);
		const proposed = proposeDecisionRecord(exploring, "ABC", record, markdown);
		expect(proposed.ledger?.items[0]?.lifecycle).toBe("proposed");
		expect(proposed.ledger?.items[0]?.exploration).toBeDefined();
		expect(proposed.proposal?.markdown).toBe(markdown);

		const resolved = resolveDecisionRecord(proposed, "ABC", record);
		expect(resolved.ledger?.items[0]?.lifecycle).toBe("resolved");
		expect(resolved.ledger?.items[0]?.exploration).toBeUndefined();
		expect(resolved.proposal).toBeUndefined();
	});

	it("supports lightweight proposals through explicit update transitions", () => {
		const open = stateWithItems("ABC");
		const markdown = renderDecisionRecordMarkdown(open.ledger!.items[0]!, record);
		const proposed = proposeDecisionRecord(open, "ABC", record, markdown);

		expect(proposed.ledger?.items[0]?.lifecycle).toBe("proposed");
		expect(proposed.ledger?.items[0]?.exploration).toBeUndefined();
		const exploredProposal = startExploration(proposed, "ABC", "entry", "return");
		expect(exploredProposal.ledger?.items[0]?.lifecycle).toBe("exploring");
		expect(exploredProposal.ledger?.items[0]?.record).toEqual(record);
		expect(exploredProposal.proposal).toEqual(proposed.proposal);
		const exitedProposal = exitExploration(exploredProposal, "ABC");
		expect(exitedProposal.ledger?.items[0]?.lifecycle).toBe("proposed");
		expect(exitedProposal.ledger?.items[0]?.record).toEqual(record);
		expect(exitedProposal.proposal).toEqual(proposed.proposal);

		const rejected = applyBatchUpdates(proposed, [{ id: "ABC", lifecycle: "open" }]);
		expect(rejected.ledger?.items[0]?.lifecycle).toBe("open");
		expect(rejected.ledger?.items[0]?.record).toBeUndefined();
		expect(rejected.proposal).toBeUndefined();

		const accepted = applyBatchUpdates(proposed, [{ id: "ABC", lifecycle: "resolved" }]);
		expect(accepted.ledger?.items[0]?.lifecycle).toBe("resolved");
		expect(accepted.ledger?.items[0]?.record).toEqual(record);
		expect(accepted.proposal).toBeUndefined();
	});

	it("allows explicit exploration exit and switching while preserving one focus", () => {
		const exploring = startExploration(stateWithItems("ABC", "XYZ"), "ABC", "entry-1", "return-ABC");
		const switched = switchExploration(exploring, "XYZ", "entry-2", "return-XYZ");
		expect(getFocusedExploration(switched)?.id).toBe("XYZ");
		expect(switched.ledger?.items[0]?.lifecycle).toBe("open");
		expect(switched.ledger?.items[0]?.exploration).toBeUndefined();

		const exited = exitExploration(switched);
		expect(getFocusedExploration(exited)).toBeUndefined();
		expect(exited.ledger?.items[1]?.lifecycle).toBe("open");
	});

	it("removes one or several current-branch items atomically without an archive state", () => {
		const initial = stateWithItems("ABC", "XYZ");
		const removed = removeDecisionItems(initial, ["abc", "XYZ"]);

		expect(removed.ledger?.items).toEqual([]);
		expect(removed.ledger?.usedIds).toEqual(["ABC", "XYZ"]);
		expect(initial.ledger?.items).toHaveLength(2);
		expect(() => removeDecisionItems(initial, ["ABC", "ABC"])).toThrow("duplicate removal");
		expect(() => removeDecisionItems(initial, ["ZZZ"])).toThrow("`ZZZ` was not found in the current ledger");

		const focused = startExploration(initial, "ABC", "entry", "return-ABC");
		expect(() => removeDecisionItems(focused, ["ABC"])).toThrow("actively explored");
	});

	it("gives ignored lifecycle precedence over resolved presentation", () => {
		expect(decisionStatePresentation({ lifecycle: "open" })).toEqual({
			symbol: "○",
			kind: "open",
			ignored: false,
			dimmed: false,
			bold: false,
		});
		expect(decisionStatePresentation({ lifecycle: "exploring" })).toMatchObject({ symbol: "◉", bold: true });
		expect(decisionStatePresentation({ lifecycle: "proposed" })).toMatchObject({ symbol: "◇" });
		expect(decisionStatePresentation({ lifecycle: "resolved" })).toMatchObject({ symbol: "✓", dimmed: true });
		expect(decisionStatePresentation({ lifecycle: "deferred" })).toMatchObject({ symbol: "⏸", dimmed: true });
		expect(decisionStatePresentation({ lifecycle: "ignored" })).toEqual({
			symbol: "−",
			kind: "ignored",
			ignored: true,
			dimmed: true,
			bold: false,
		});
	});
});

describe("initial add lifecycle matrix", () => {
	it("supports every valid initial lifecycle and preserves records and proposed drafts", () => {
		const added = addDecisionItems(emptyLedgerState(), [
			{ title: "Open choice", point: "Choose an implementation" },
			{ title: "Proposed choice", point: "Use the proposed implementation", lifecycle: "proposed", record },
			{ title: "Resolved choice", point: "The implementation choice", lifecycle: "resolved", record },
			{ title: "Deferred choice", point: "Revisit the implementation", lifecycle: "deferred" },
			{ title: "Deferred record", point: "Revisit with context", lifecycle: "deferred", record },
			{ title: "Ignored choice", point: "Do not pursue this option", lifecycle: "ignored", record },
		], { randomBytes: randomBytesForIds("AAA", "BBB", "CCC", "DDD", "EEE", "FFF") });

		expect(added.ledger?.items.map((item) => item.lifecycle)).toEqual([
			"open", "proposed", "resolved", "deferred", "deferred", "ignored",
		]);
		expect(added.ledger?.items[0]?.record).toBeUndefined();
		expect(added.ledger?.items[1]?.record).toEqual(record);
		expect(added.ledger?.items[2]?.record).toEqual(record);
		expect(added.ledger?.items[3]?.record).toBeUndefined();
		expect(added.ledger?.items[4]?.record).toEqual(record);
		expect(added.ledger?.items[5]?.record).toEqual(record);
		expect(added.ledger?.items[1]?.proposalMarkdown).toBe(
			renderDecisionRecordMarkdown(added.ledger!.items[1]!, record),
		);
		expect(added.proposal).toBeUndefined();
	});

	it("rejects every invalid initial lifecycle and record combination before allocation", () => {
		const invalidInputs: Array<AddDecisionItemInput> = [
			{ title: "Open with record", point: "Open", record },
			{ title: "Proposed without record", point: "Proposed", lifecycle: "proposed" },
			{ title: "Resolved without record", point: "Resolved", lifecycle: "resolved" },
			{ title: "Ignored without record", point: "Ignored", lifecycle: "ignored" },
			{ title: "Deferred malformed", point: "Deferred", lifecycle: "deferred", record: { ...record, context: "" } },
			{ title: "Proposed malformed", point: "Proposed", lifecycle: "proposed", record: { ...record, optionsConsidered: ["", "valid"] } },
			{ title: "Exploring", point: "Exploring", lifecycle: "exploring" as never },
		];

		for (const input of invalidInputs) {
			const randomBytes = vi.fn(randomBytesForIds("ABC"));
			expect(() => addDecisionItems(emptyLedgerState(), [input], { randomBytes })).toThrow();
			expect(randomBytes).not.toHaveBeenCalled();
		}
	});

	it("rejects a mixed batch atomically without consuming IDs or mutating the source", () => {
		const source = addDecisionItems(emptyLedgerState(), [{ title: "Existing", point: "Existing point" }], {
			randomBytes: randomBytesForIds("OLD"),
		});
		const before = cloneState(source);
		const randomBytes = vi.fn(randomBytesForIds("NEW", "BAD"));

		expect(() => addDecisionItems(source, [
			{ title: "Valid", point: "Valid point", lifecycle: "proposed", record },
			{ title: "Invalid", point: "Invalid point", lifecycle: "open", record },
		], { randomBytes })).toThrow("cannot include a decision record");
		expect(randomBytes).not.toHaveBeenCalled();
		expect(source).toEqual(before);
	});

	it("keeps random-ID collision retries and historical reservations correct", () => {
		const source: LedgerState = { ledger: { items: [], usedIds: ["ABC", "DEF"] } };
		const randomBytes = vi.fn(randomBytesForIds("ABC", "XYZ", "GHI", "JKL"));
		const added = addDecisionItems(source, [
			{ title: "First", point: "First point" },
			{ title: "Second", point: "Second point" },
		], { reservedIds: ["XYZ"], randomBytes });

		expect(added.ledger?.items.map((item) => item.id)).toEqual(["GHI", "JKL"]);
		expect(added.ledger?.usedIds).toEqual(["ABC", "DEF", "XYZ", "GHI", "JKL"]);
	});

	it("supports independent proposed drafts through replay, exploration, revision, exit, and acceptance", () => {
		const recordA = { ...record, decision: "Use approach A." };
		const recordB = { ...record, decision: "Use approach B." };
		const proposed = addDecisionItems(emptyLedgerState(), [
			{ title: "First proposal", point: "Investigate A", lifecycle: "proposed", record: recordA },
			{ title: "Second proposal", point: "Investigate B", lifecycle: "proposed", record: recordB },
		], { randomBytes: randomBytesForIds("AAA", "BBB") });
		const [itemA, itemB] = proposed.ledger!.items;
		const markdownA = renderDecisionRecordMarkdown(itemA!, recordA);
		const markdownB = renderDecisionRecordMarkdown(itemB!, recordB);
		expect(itemA?.proposalMarkdown).toBe(markdownA);
		expect(itemB?.proposalMarkdown).toBe(markdownB);

		const focused = startExploration(proposed, itemA!.id, "entry-A", "return-A");
		expect(getDecisionProposal(focused, itemA!.id)?.markdown).toBe(markdownA);
		expect(getDecisionProposal(focused, itemB!.id)?.markdown).toBe(markdownB);
		const exited = exitExploration(focused, itemA!.id);
		expect(exited.ledger?.items[0]?.lifecycle).toBe("proposed");
		expect(exited.ledger?.items[0]?.proposalMarkdown).toBe(markdownA);

		const revisedRecord = { ...recordA, decision: "Use revised approach A." };
		const revisedMarkdown = renderDecisionRecordMarkdown(exited.ledger!.items[0]!, revisedRecord);
		const revised = proposeDecisionRecord(exited, itemA!.id, revisedRecord, revisedMarkdown);
		const accepted = applyBatchUpdates(revised, [{ id: itemA!.id, lifecycle: "resolved" }]);
		expect(accepted.ledger?.items[0]?.record).toEqual(revisedRecord);
		expect(accepted.ledger?.items[0]?.proposalMarkdown).toBeUndefined();
		expect(getDecisionProposal(accepted, itemB!.id)?.markdown).toBe(markdownB);

		const replayed = replayLedgerBranch([customEntry("initial-proposals", proposed)]);
		expect(replayed.ledger?.items[0]?.proposalMarkdown).toBe(markdownA);
		expect(replayed.ledger?.items[1]?.proposalMarkdown).toBe(markdownB);
	});

	it("keeps initial terminal and deferred items complete in ordering, counts, details, and export", () => {
		const state = addDecisionItems(emptyLedgerState(), [
			{ title: "Ignored", point: "Ignore this", lifecycle: "ignored", record },
			{ title: "Open", point: "Decide this" },
			{ title: "Deferred", point: "Decide later", lifecycle: "deferred" },
			{ title: "Resolved", point: "Already decided", lifecycle: "resolved", record },
		], { randomBytes: randomBytesForIds("IGN", "OPN", "DEF", "RES") });

		expect(decisionProgress(state)).toEqual({ completed: 2, total: 4 });
		expect(orderDecisionItems(state.ledger!.items).map((item) => item.title)).toEqual([
			"Open", "Deferred", "Resolved", "Ignored",
		]);
		expect(orderActionableDecisionItems(state.ledger!.items).map((item) => item.title)).toEqual(["Open"]);
		expect(formatDecisionDetail(state, "RES")).toContain("Use the narrow API.");
		const exported = formatDecisionExport(state);
		expect(exported).toContain("Already decided");
		expect(exported).toContain("Use the narrow API.");
		expect(exported).toContain("No complete decision record is present for this item.");
	});
});

describe("resolved lifecycle model and migrations", () => {
	it("migrates old lifecycle and dispositions without rewriting the source snapshot", () => {
		const legacyState = {
			ledger: {
				items: [
					{ id: "OLD", point: "Old proposal", lifecycle: "resolution_proposed", record },
					{ id: "IGN", point: "Ignore me", lifecycle: "resolved", disposition: "ignored", record },
					{ id: "ACC", point: "Accept me", lifecycle: "open", disposition: "accepted", record },
					{ id: "FUP", point: "Follow up", lifecycle: "deferred", disposition: "follow_up", record },
				],
				nextId: 14,
				usedIds: ["OLD", "IGN", "ACC", "FUP", "RESERVED"],
			},
			proposal: { itemId: "OLD", record, markdown: "old draft" },
		};
		const entry = toolEntry("legacy", legacyState as unknown as LedgerState);
		const migrated = replayLedgerBranch([entry]);
		expect(migrated.ledger?.items.map((item) => [item.id, item.lifecycle])).toEqual([
			["OLD", "proposed"],
			["IGN", "ignored"],
			["ACC", "resolved"],
			["FUP", "resolved"],
		]);
		expect(migrated.ledger?.nextId).toBe(14);
		expect(migrated.ledger?.usedIds).toEqual(["OLD", "IGN", "ACC", "FUP", "RESERVED"]);
		expect(getDecisionProposal(migrated, "OLD")?.markdown).toBe("old draft");
		expect((legacyState.ledger.items[0] as { lifecycle: string }).lifecycle).toBe("resolution_proposed");
		expect((legacyState.ledger.items[1] as { disposition: string }).disposition).toBe("ignored");
	});

	it("replays mixed old and new entries and keeps tool-result details safe", () => {
		const legacy = toolEntry("old", {
			ledger: { items: [{ id: "OLD", point: "Old", lifecycle: "resolution_proposed" }] },
		} as unknown as LedgerState);
		const modern = customEntry("new", { ledger: { items: [
			{ id: "OLD", point: "Old", lifecycle: "proposed" },
			{ id: "NEW", point: "New", lifecycle: "ignored" },
		], usedIds: ["OLD", "NEW"] } });
		const replayed = replayLedgerBranch([legacy, modern]);
		expect(replayed.ledger?.items).toEqual([
			{ id: "OLD", point: "Old", lifecycle: "proposed" },
			{ id: "NEW", point: "New", lifecycle: "ignored" },
		]);
		const oldBranch = replayLedgerBranch([legacy]);
		expect(oldBranch.ledger?.items[0]?.lifecycle).toBe("proposed");
	});

	it("serializes only the new lifecycle schema", () => {
		const legacyRuntimeState = {
			ledger: { items: [{ id: "OLD", point: "Old", lifecycle: "resolved", disposition: "chosen" }] },
		} as unknown as LedgerState;
		const cloned = cloneState(legacyRuntimeState);
		expect(JSON.stringify(cloned)).not.toContain("disposition");
		expect(formatDecisionExport(cloned)).not.toContain("Disposition:");
		expect(LIFECYCLES).toEqual(["open", "exploring", "proposed", "resolved", "deferred", "ignored"]);
	});

	it("covers terminal, reopening, and active-exploration transition guards", () => {
		const open = stateWithItems("ABC");
		expect(decisionActionReason(open, "ABC", "ignore")).toBeUndefined();
		const ignored = applyDecisionAction(open, "ABC", "ignore");
		expect(ignored.ledger?.items[0]?.lifecycle).toBe("ignored");
		expect(decisionActionReason(ignored, "ABC", "defer")).toContain("reopen");
		const reopened = applyDecisionAction(ignored, "ABC", "reopen");
		expect(reopened.ledger?.items[0]?.lifecycle).toBe("open");
		const deferred = applyDecisionAction(reopened, "ABC", "defer");
		expect(deferred.ledger?.items[0]?.lifecycle).toBe("deferred");
		const openAgain = applyDecisionAction(deferred, "ABC", "reopen");
		const resolved = applyBatchUpdates(openAgain, [{ id: "ABC", lifecycle: "resolved", record }]);
		expect(isDecisionCompleted(resolved.ledger!.items[0]!)).toBe(true);
		expect(decisionActionReason(resolved, "ABC", "ignore")).toContain("already resolved");
		expect(() => applyDecisionAction(resolved, "ABC", "ignore")).toThrow("already resolved");

		const focused = startExploration(openAgain, "ABC", "entry", "return");
		expect(decisionActionReason(focused, "ABC", "remove")).toContain("actively explored");
		expect(decisionActionReason(focused, "ABC", "defer")).toContain("actively explored");
		expect(() => applyDecisionAction(focused, "ABC", "remove")).toThrow("actively explored");
	});

	it("tracks completion with deferred excluded and ignored included", () => {
		const state: LedgerState = { ledger: { items: [
			{ id: "A01", point: "Open", lifecycle: "open" },
			{ id: "A02", point: "Resolved", lifecycle: "resolved" },
			{ id: "A03", point: "Ignored", lifecycle: "ignored" },
			{ id: "A04", point: "Deferred", lifecycle: "deferred" },
		] } };
		expect(decisionProgress(state)).toEqual({ completed: 2, total: 4 });
		expect(orderActionableDecisionItems(state.ledger!.items).map((item) => item.id)).toEqual(["A01"]);
	});
});

describe("proposal exploration lifecycle", () => {
	it("preserves unchanged and revised lightweight drafts through exploration exit", () => {
		const open = stateWithItems("ABC", "XYZ");
		const initialMarkdown = renderDecisionRecordMarkdown(open.ledger!.items[0]!, record);
		const proposed = proposeDecisionRecord(open, "ABC", record, initialMarkdown);
		const focused = startExploration(proposed, "ABC", "entry-1", "return-ABC");
		expect(focused.ledger?.items[0]?.exploration?.origin).toBe("proposed");
		const acceptedUnchanged = resolveDecisionRecord(focused, "ABC", record);
		expect(acceptedUnchanged.ledger?.items[0]?.lifecycle).toBe("resolved");
		expect(acceptedUnchanged.ledger?.items[0]?.record).toEqual(record);
		expect(acceptedUnchanged.proposal).toBeUndefined();

		const exited = exitExploration(focused, "ABC");
		expect(exited.ledger?.items[0]).toEqual(proposed.ledger?.items[0]);
		expect(exited.proposal).toEqual(proposed.proposal);

		const revisedRecord = { ...record, decision: "Use the revised narrow API." };
		const revisedMarkdown = renderDecisionRecordMarkdown(exited.ledger!.items[0]!, revisedRecord);
		const revised = proposeDecisionRecord(exited, "ABC", revisedRecord, revisedMarkdown);
		const revisedFocus = startExploration(revised, "ABC", "entry-2", "return-ABC");
		const revisedExit = exitExploration(revisedFocus, "ABC");
		expect(revisedExit.proposal?.markdown).toBe(revisedMarkdown);
		expect(revisedExit.ledger?.items[0]?.record).toEqual(revisedRecord);
	});

	it("switches focus without finalizing or discarding a lightweight proposal", () => {
		const proposed = proposeDecisionRecord(stateWithItems("ABC", "XYZ"), "ABC", record, "draft-ABC");
		const focused = startExploration(proposed, "ABC", "entry-1", "return-ABC");
		const switched = switchExploration(focused, "XYZ", "entry-2", "return-XYZ");
		expect(switched.ledger?.items[0]?.lifecycle).toBe("proposed");
		expect(switched.ledger?.items[0]?.exploration).toBeUndefined();
		expect(switched.ledger?.items[0]?.record).toEqual(record);
		expect(switched.proposal).toEqual(proposed.proposal);
		expect(getFocusedExploration(switched)?.id).toBe("XYZ");
	});

	it("keeps each lightweight proposal draft when proposals are explored and switched", () => {
		const recordA = { ...record, decision: "Use approach A." };
		const recordB = { ...record, decision: "Use approach B." };
		const proposedA = proposeDecisionRecord(stateWithItems("ABC", "XYZ"), "ABC", recordA, "draft-A");
		const proposedBoth = proposeDecisionRecord(proposedA, "XYZ", recordB, "draft-B");
		const focusedA = startExploration(proposedBoth, "ABC", "entry-A", "return-ABC");

		expect(focusedA.proposal?.itemId).toBe("ABC");
		expect(getDecisionProposal(focusedA, "ABC")?.markdown).toBe("draft-A");
		expect(getDecisionProposal(focusedA, "XYZ")?.markdown).toBe("draft-B");

		const exitedA = exitExploration(focusedA, "ABC");
		const focusedB = startExploration(exitedA, "XYZ", "entry-B", "return-XYZ");
		expect(focusedB.proposal?.itemId).toBe("XYZ");
		const focusedAgainA = switchExploration(focusedB, "ABC", "entry-A-2", "return-ABC-2");
		expect(getDecisionProposal(focusedAgainA, "ABC")?.markdown).toBe("draft-A");
		expect(getDecisionProposal(focusedAgainA, "XYZ")?.markdown).toBe("draft-B");
		const replayed = replayLedgerBranch([customEntry("focused", focusedAgainA)]);
		expect(getDecisionProposal(replayed, "ABC")?.markdown).toBe("draft-A");
		expect(getDecisionProposal(replayed, "XYZ")?.markdown).toBe("draft-B");

		const resolvedA = resolveDecisionRecord(focusedAgainA, "ABC", recordA);
		expect(getDecisionProposal(resolvedA, "ABC")).toBeUndefined();
		expect(getDecisionProposal(resolvedA, "XYZ")?.markdown).toBe("draft-B");
	});
});

describe("formatting and command completion", () => {
	it("round-trips the compact editable Markdown record", () => {
		const item = { id: "ABC", point: "Choose an implementation" };
		const markdown = renderDecisionRecordMarkdown(item, record);
		expect(parseDecisionRecordMarkdown(markdown)).toEqual({ record, errors: [] });

		const invalid = parseDecisionRecordMarkdown("### Context\nOnly context");
		expect(invalid.record).toBeUndefined();
		expect(invalid.errors).toContain("Decision / outcome is required");
	});

	it("keeps bounded output within the requested limit", () => {
		for (const limit of [0, 5, 18, 19, 32]) {
			expect(boundLedgerOutput("a long decision ledger", limit).length).toBeLessThanOrEqual(limit);
			expect(formatLedgerMarkdown(emptyLedgerState(), limit).length).toBeLessThanOrEqual(limit);
		}
	});

	it("stores concise titles while retaining complete points and supports legacy fallback", () => {
		const titled = addDecisionItems(emptyLedgerState(), [{ title: "Choose API", point: "Choose the narrow or broad API for every caller." }], {
			randomBytes: randomBytesForIds("ABC"),
		});
		const item = titled.ledger!.items[0]!;
		expect(item.title).toBe("Choose API");
		expect(decisionDisplayTitle(item)).toBe("Choose API");
		expect(formatDecisionOverview(titled)).toContain("| `ABC` | open | Choose API |");
		expect(formatDecisionOverview(titled)).not.toContain("Choose the narrow or broad API for every caller.");
		expect(formatDecisionDetail(titled, "ABC")).toContain("Title: Choose API");
		expect(formatDecisionDetail(titled, "ABC")).toContain("Choose the narrow or broad API for every caller.");
		expect(formatDecisionExport(titled)).toContain("Choose the narrow or broad API for every caller.");

		const legacy = { id: "XYZ", point: "Legacy complete point", lifecycle: "open" as const };
		expect(decisionDisplayTitle(legacy)).toBe(legacy.point);
		expect(formatDecisionOverview({ ledger: { items: [legacy] } })).toContain("| `XYZ` | open | Legacy complete point |");
	});

	it("centralizes distinct Markdown and TUI ID formatting without changing the raw ID", () => {
		expect(formatDecisionId("ABC")).toBe("`ABC`");
		expect(formatDecisionId("ABC", "tui")).toBe("[ABC]");
		expect(formatDecisionIdForTui("123")).toBe("[123]");
		expect(formatDecisionId("A`B")).toBe("``A`B``");
	});

	it("renders the widget from actual width with Unicode and ANSI styling", () => {
		const theme: any = {
			fg: (color: string, text: string) => `\\x1b[3${color.length}m${text}\\x1b[39m`,
			bold: (text: string) => `\\x1b[1m${text}\\x1b[22m`,
			strikethrough: (text: string) => `\\x1b[9m${text}\\x1b[29m`,
		};
		const state = addDecisionItems(emptyLedgerState(), [{ title: "Long 日本語 title that must fit", point: "Complete point" }], {
			randomBytes: randomBytesForIds("ABC"),
		});
		const widget = new DecisionWidget(state, theme);
		for (const width of [0, 1, 8, 16, 24, 40]) {
			for (const line of widget.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		const rendered = widget.render(16).join("\\n");
		expect(rendered).toContain("[ABC]");
		expect(rendered).not.toContain("Long 日本語 title that must fit");
	});

	it("renders an interactive detail body without duplicate metadata or record sections", () => {
		const titled = addDecisionItems(emptyLedgerState(), [{ title: "Choose API", point: "Complete point" }], {
			randomBytes: randomBytesForIds("ABC"),
		});
		const resolved = applyBatchUpdates(titled, [{ id: "ABC", lifecycle: "resolved", record }]);
		const detail = formatDecisionDetail(resolved, "ABC");
		expect(detail.match(/### Point/g)).toHaveLength(1);
		expect(detail.match(/### Context/g)).toHaveLength(1);
		expect(detail.match(/### Options considered/g)).toHaveLength(1);
		expect(detail).not.toContain("Complete decision record");
		expect(detail).not.toContain("return label");
		expect(detail.match(/Complete point/g)).toHaveLength(1);
		expect(detail.match(/Choose API/g)).toHaveLength(1);
	});

	it("formats a compact overview and textual detail", () => {
		const resolved = applyBatchUpdates(stateWithItems("ABC"), [{ id: "ABC", lifecycle: "resolved", record }]);
		const overview = formatDecisionOverview(resolved);
		const detail = formatDecisionDetail(resolved, "abc");

		expect(overview).toContain("| `ABC` | resolved | Point 1 |");
		expect(overview).not.toContain("Use the narrow API.");
		expect(formatLedgerMarkdown(resolved)).not.toContain("Use the narrow API.");
		expect(detail).toContain("Use the narrow API.");
		expect(formatDecisionDetail(resolved, "MISSING")).toContain("`MISSING` was not found in the current ledger");
	});

	it("formats the exact concise success receipt without color or record duplication", () => {
		expect(formatReturnReceipt("ABC", record.decision, "unused-tip")).toBe("Decision `ABC` resolved: Use the narrow API.");
		expect(formatReturnReceipt("ABC", "a ".repeat(200))).not.toContain("\x1b[");
		expect(formatReturnReceipt("ABC", record.decision)).not.toContain(record.context);
	});

	it("completes command names and one or several generic IDs", () => {
		const items = [
			{ id: "ABC", point: "Choose an implementation" },
			{ id: "XYZ", point: "Confirm rollout" },
		];

		expect(completeDecisionCommandArguments("", items)?.map((item) => item.value)).toEqual([...DECISION_COMMANDS]);
		expect(completeDecisionCommandArguments("explore ", items)?.map((item) => item.value)).toEqual(["explore ABC", "explore XYZ"]);
		const completion = completeDecisionCommandArguments("explore x", items)?.[0];
		expect(completion).toMatchObject({ value: "explore XYZ", label: "[XYZ]" });
		expect(completion?.value).toBe("explore XYZ");
		expect(completeDecisionCommandArguments("remove ", items)?.map((item) => item.value)).toEqual(["remove ABC", "remove XYZ"]);
		expect(completeDecisionCommandArguments("remove ABC ", items)?.map((item) => item.value)).toEqual(["remove ABC XYZ"]);
		expect(completeDecisionCommandArguments("explore ABC ", items)).toBeNull();
		expect(completeDecisionsCommandArguments("")?.map((item) => item.value)).toEqual(["recover", "export"]);
		expect(completeDecisionsCommandArguments("rec")?.[0]?.value).toBe("recover");
		expect(completeDecisionsCommandArguments("exp")?.[0]?.value).toBe("export");
	});

	it("routes compact overviews through each Pi mode's available output", () => {
		expect(decisionOverviewDelivery("tui", true)).toBe("notify");
		expect(decisionOverviewDelivery("rpc", true)).toBe("notify");
		expect(decisionOverviewDelivery("print", false)).toBe("print");
		expect(decisionOverviewDelivery("json", false)).toBe("message");
	});

	it("documents TUI Markdown rendering separately from JSON and RPC event delivery", () => {
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

		expect(readme).toContain("In TUI mode, it is delivered as a visible custom message rendered as Markdown.");
		expect(readme).toContain("In JSON and RPC modes, it is exposed as visible custom-message events containing the Markdown; clients are responsible for rendering it. The command does not trigger a model turn; print mode writes it to stdout.");
		expect(readme).not.toContain("In TUI, JSON, and RPC modes it is delivered as a visible rendered custom message");
	});

	it("orders ignored decisions last without mutating canonical state order", () => {
		const items = [
			{ id: "IGN", point: "Ignored point", lifecycle: "ignored" as const },
			{ id: "ABC", point: "Open point", lifecycle: "open" as const },
			{ id: "DEF", point: "Deferred point", lifecycle: "deferred" as const },
			{ id: "SKP", point: "Second ignored point", lifecycle: "ignored" as const },
		];

		expect(orderDecisionItems(items).map((item) => item.id)).toEqual(["ABC", "DEF", "IGN", "SKP"]);
		expect(items.map((item) => item.id)).toEqual(["IGN", "ABC", "DEF", "SKP"]);
		const overview = formatDecisionOverview({ ledger: { items } });
		expect(overview.indexOf("| `ABC` |")).toBeLessThan(overview.indexOf("| `IGN` |"));
		expect(overview.indexOf("| `IGN` |")).toBeLessThan(overview.indexOf("| `SKP` |"));
	});

	it("exports every current-branch field without compact truncation or extension internals", () => {
		const longPoint = `Choose an approach ${"x".repeat(13000)}`;
		const exportState: LedgerState = {
			ledger: {
				items: [
					{
						id: "IGN",
						point: "Ignored **point** | `code`",
						lifecycle: "ignored",
						record: {
							decision: "Use **the narrow API**.",
							context: "Evidence includes `special` Markdown.",
							optionsConsidered: ["A | B", "``` nested fence ```"],
							consequences: "The broad API remains available.",
							followUps: ["Add an integration test."],
						},
						exploration: { returnEntryId: "session-entry-ignored", returnLabel: "decision-return-IGN", origin: "open" },
					},
					{ id: "ABC", point: longPoint, lifecycle: "open" },
					{ id: "DEF", point: "No record point", lifecycle: "deferred" },
				],
				usedIds: ["IGN", "ABC", "DEF", "OFF"],
			},
			proposal: {
				itemId: "ABC",
				record: record,
				markdown: "hidden proposal markdown",
			},
		};

		const markdown = formatDecisionExport(exportState);
		expect(markdown.length).toBeGreaterThan(12000);
		expect(markdown).toContain("## Decision `ABC`");
		expect(markdown).toContain(longPoint);
		expect(markdown).toContain("## Decision `IGN`");
		expect(markdown).toContain("Lifecycle: **ignored**");
		expect(markdown).not.toContain("Disposition:");
		expect(markdown).toContain("Use **the narrow API**.");
		expect(markdown).toContain("Evidence includes `special` Markdown.");
		expect(markdown).toContain("A | B");
		expect(markdown).toContain("``` nested fence ```");
		expect(markdown).toContain("The broad API remains available.");
		expect(markdown).toContain("Add an integration test.");
		expect(markdown).toContain("No complete decision record is present for this item.");
		expect(markdown.indexOf("## Decision `ABC`")).toBeLessThan(markdown.indexOf("## Decision `IGN`"));
		expect(markdown).not.toContain("session-entry-ignored");
		expect(markdown).not.toContain("decision-return-IGN");
		expect(markdown).not.toContain("OFF");
		expect(markdown).not.toContain("hidden proposal markdown");
	});

	it("exports empty and all-resolved ledgers", () => {
		expect(formatDecisionExport(emptyLedgerState())).toContain("No decisions are present on this branch.");
		const resolved = applyBatchUpdates(stateWithItems("ABC"), [{ id: "ABC", lifecycle: "resolved", record }]);
		const markdown = formatDecisionExport(resolved);
		expect(markdown).toContain("## Decision `ABC`");
		expect(markdown).toContain("Lifecycle: **resolved**");
		expect(markdown).not.toContain("Disposition:");
		expect(markdown).toContain("Use the narrow API.");
		expect(markdown).not.toContain("No decisions are present");
	});

	it("routes complete exports to print or visible custom messages without a model turn", () => {
		expect(decisionExportDelivery("tui")).toBe("message");
		expect(decisionExportDelivery("rpc")).toBe("message");
		expect(decisionExportDelivery("json")).toBe("message");
		expect(decisionExportDelivery("print")).toBe("print");
	});

	it("normalizes concise decision points", () => {
		expect(conciseDecisionPoint("  many   words here ")).toBe("many words here");
		expect(conciseDecisionPoint("abcdef", 5)).toBe("ab...");
	});
});

describe("migration, branch replay, and ID history", () => {
	it("loads legacy D-number snapshots unchanged and reserves historical IDs", () => {
		const legacy: LedgerState = {
			ledger: {
				items: [{ id: "D1", point: "Legacy point", lifecycle: "open" }],
				nextId: 2,
			},
		};
		const entries = [toolEntry("legacy", legacy)];
		const replayed = replayLedgerBranch(entries);

		expect(replayed).toEqual(legacy);
		expect(collectDecisionIds(entries)).toEqual(new Set(["D1"]));
		expect(replayLedgerBranch([toolEntry("new-format", { ledger: { items: [{ id: "ABC", point: "New point", lifecycle: "open" }], usedIds: ["ABC"] } })])).toEqual({
			ledger: { items: [{ id: "ABC", point: "New point", lifecycle: "open" }], usedIds: ["ABC"] },
		});
		const added = addDecisionItems(replayed, [{ point: "New point" }], {
			reservedIds: collectDecisionIds(entries),
			randomBytes: randomBytesForIds("D12"),
		});
		expect(added.ledger?.items.map((item) => item.id)).toEqual(["D1", "D12"]);
	});

	it("keeps removed items in earlier snapshots while current replay omits them", () => {
		const first = stateWithItems("ABC");
		const removed = removeDecisionItems(first, ["ABC"]);
		const entries = [toolEntry("before", first), customEntry("removed", removed)];

		expect(replayLedgerBranch(entries).ledger?.items).toEqual([]);
		expect(replayLedgerBranch([entries[0]!]).ledger?.items[0]?.id).toBe("ABC");
	});

	it("anchors natural-language exploration before its triggering user message", () => {
		const entries = [
			messageEntry("prior-assistant", "assistant"),
			messageEntry("trigger-user", "user"),
			messageEntry("tool-call", "assistant"),
		];

		expect(findNaturalLanguageExplorationReturnEntryId(entries, "tool-call")).toBe("prior-assistant");
		expect(findNaturalLanguageExplorationReturnEntryId([messageEntry("root-user", "user"), messageEntry("tool-call", "assistant")], "tool-call")).toBeUndefined();
	});

	it("replays only the selected branch and retains focus lifecycle per branch", () => {
		const focused = startExploration(stateWithItems("ABC"), "ABC", "entry", "return-ABC");
		const entries = [toolEntry("focused", focused), customEntry("other", emptyLedgerState())];

		expect(getFocusedExploration(replayLedgerBranch([entries[0]!]))?.id).toBe("ABC");
		expect(getFocusedExploration(replayLedgerBranch([entries[1]!]))).toBeUndefined();
	});

	it("starts a forked session empty and ignores copied snapshots before its reset marker", () => {
		const source = stateWithItems("ABC");
		const reset = forkResetEntry("fork-reset");
		const fresh = stateWithItems("XYZ");
		const sessionEntries = [toolEntry("copied", source), reset, toolEntry("fresh", fresh)];

		expect(replayLedgerBranch([toolEntry("copied", source)], sessionEntries)).toEqual(emptyLedgerState());
		expect(replayLedgerBranch([toolEntry("copied", source), reset], sessionEntries)).toEqual(emptyLedgerState());
		expect(replayLedgerBranch([toolEntry("copied", source), toolEntry("fresh", fresh)], sessionEntries)).toEqual(fresh);
	});

	it("does not mutate source state while cloning a recovered snapshot", () => {
		const source = stateWithItems("ABC");
		const recovered = cloneState(source);
		recovered.ledger!.items[0]!.point = "Edited on destination";
		expect(source.ledger?.items[0]?.point).toBe("Point 1");
	});

	it("finds the newest off-branch ledger snapshot", () => {
		const first = stateWithItems("ABC");
		const newest = stateWithItems("ABC", "XYZ");
		const entries = [toolEntry("current", first), customEntry("off-old", first), customEntry("off-new", newest)];
		const candidate = findNewestOffBranchSnapshot(entries, new Set(["current"]));

		expect(candidate?.entryId).toBe("off-new");
		expect(candidate?.state).toEqual(newest);
		expect(findNewestOffBranchSnapshot(entries, new Set(["current", "off-old", "off-new"]))).toBeUndefined();
	});
});

describe("extension lifecycle hooks", () => {
	interface FakeContext {
		mode: "tui" | "rpc" | "json" | "print";
		hasUI: boolean;
		ui: {
			theme: any;
			notify: ReturnType<typeof vi.fn>;
			setWidget: ReturnType<typeof vi.fn>;
			setWorkingMessage: ReturnType<typeof vi.fn>;
			setWorkingIndicator: ReturnType<typeof vi.fn>;
			setWorkingVisible: ReturnType<typeof vi.fn>;
			editor: ReturnType<typeof vi.fn>;
			confirm: ReturnType<typeof vi.fn>;
			custom: ReturnType<typeof vi.fn>;
		};
		sessionManager: {
			getBranch: () => object[];
			getEntries: () => object[];
			getLeafId: () => string | undefined;
		};
		navigateTree: ReturnType<typeof vi.fn>;
		isIdle: ReturnType<typeof vi.fn>;
	}

	function makeFakeExtension(mode: FakeContext["mode"] = "tui") {
		const handlers = new Map<string, (event: any, ctx: FakeContext) => unknown>();
		const commands = new Map<string, { handler: (args: string, ctx: FakeContext) => Promise<void> }>();
		let tool: any;
		let entries: object[] = [];
		let leafId: string | undefined = "tool-call";
		let appendedEntryNumber = 0;
		const pi: any = {
			on: (event: string, handler: (event: any, ctx: FakeContext) => unknown) => handlers.set(event, handler),
			registerTool: (definition: unknown) => { tool = definition; },
			registerCommand: (name: string, definition: any) => commands.set(name, definition),
			registerMessageRenderer: vi.fn(),
			appendEntry: vi.fn((customType: string, data: unknown) => {
				const entry = { type: "custom", id: `extension-${appendedEntryNumber++}`, customType, data };
				entries = [...entries, entry];
				leafId = entry.id;
			}),
			setLabel: vi.fn(),
			sendMessage: vi.fn((message: any) => {
				const entry = {
					type: "custom_message",
					id: `message-${appendedEntryNumber++}`,
					customType: message.customType,
					content: message.content,
					display: message.display,
					details: message.details,
				};
				entries = [...entries, entry];
				leafId = entry.id;
			}),
			sendUserMessage: vi.fn(),
		};
		const context: FakeContext = {
			mode,
			hasUI: mode === "tui" || mode === "rpc",
			ui: {
				theme: {
					fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
					bold: (text: string) => `<bold>${text}</bold>`,
					strikethrough: (text: string) => `<strike>${text}</strike>`,
				},
				notify: vi.fn(),
				setWidget: vi.fn(),
				setWorkingMessage: vi.fn(),
				setWorkingIndicator: vi.fn(),
				setWorkingVisible: vi.fn(),
				editor: vi.fn(),
				confirm: vi.fn(),
				custom: vi.fn(),
			},
			sessionManager: {
				getBranch: () => entries,
				getEntries: () => entries,
				getLeafId: () => leafId,
			},
			navigateTree: vi.fn(async () => ({ cancelled: false })),
			isIdle: vi.fn(() => true),
		};
		decisionLedgerExtension(pi);
		return {
			handlers,
			commands,
			tool,
			pi,
			context,
			getEntries: () => entries,
			setEntries: (next: object[]) => { entries = next; },
			setLeaf: (next: string | undefined) => { leafId = next; },
		};
	}

	it("describes initial add lifecycle and record fields in the TypeBox schema", () => {
		const fake = makeFakeExtension();
		const itemSchema = fake.tool.parameters.properties.items.items;
		expect(itemSchema.properties.lifecycle.enum).toEqual(["open", "proposed", "resolved", "deferred", "ignored"]);
		expect(itemSchema.properties.lifecycle.description).toContain("open by default");
		expect(itemSchema.properties.lifecycle.description).toContain("user supplied or accepted");
		expect(itemSchema.properties.record.description).toContain("forbidden for open");
		expect(itemSchema.required).toEqual(["title", "point"]);
	});

	it("reports every added item's initial lifecycle concisely and atomically", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", {
			action: "add",
			items: [
				{ title: "Open", point: "Open" },
				{ title: "Proposed", point: "Proposed", lifecycle: "proposed", record },
				{ title: "Resolved", point: "Resolved", lifecycle: "resolved", record },
				{ title: "Deferred", point: "Deferred", lifecycle: "deferred" },
				{ title: "Ignored", point: "Ignored", lifecycle: "ignored", record },
			],
		}, undefined, undefined, fake.context);
		const items = added.details.state.ledger.items;
		const output = added.content[0].text as string;
		expect(output).toBe(`Added ${items.map((item: { id: string; lifecycle: string }) => `\`${item.id}\` (${item.lifecycle})`).join(", ")}.`);

		const beforeEntries = fake.getEntries();
		const refused = await fake.tool.execute("call", {
			action: "add",
			items: [
				{ title: "Would add", point: "Would add" },
				{ title: "Invalid", point: "Invalid", lifecycle: "open", record },
			],
		}, undefined, undefined, fake.context);
		expect(refused.content[0].text).toContain("cannot include a decision record");
		expect(refused.details.state.ledger.items).toEqual(items);
		expect(fake.getEntries()).toEqual(beforeEntries);
	});

	it("injects focus every agent turn, replays it with the branch, and removes it after resolution", async () => {
		const fake = makeFakeExtension();
		const prior = messageEntry("prior", "assistant");
		const trigger = messageEntry("trigger", "user");
		const toolCall = messageEntry("tool-call", "assistant");
		fake.setEntries([prior, trigger, toolCall]);
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Choose an approach" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		const explored = await fake.tool.execute("call", { action: "explore", id }, undefined, undefined, fake.context);
		expect(explored.details.state.ledger.items[0].lifecycle).toBe("exploring");

		const focused = await fake.handlers.get("before_agent_start")!({ systemPrompt: "base" }, fake.context) as { systemPrompt: string };
		expect(focused.systemPrompt).toContain(`[Decision focus: \`${id}\`]`);
		expect(focused.systemPrompt).toContain("do not reject unrelated prompts");

		fake.setEntries([customEntry("other-branch", emptyLedgerState())]);
		await fake.handlers.get("session_tree")!({}, fake.context);
		const branchUnfocused = await fake.handlers.get("before_agent_start")!({ systemPrompt: "base" }, fake.context);
		expect(branchUnfocused).toBeUndefined();

		const proposed = proposeDecisionRecord(explored.details.state, id, record, "draft");
		const resolved = resolveDecisionRecord(proposed, id, record);
		fake.setEntries([toolEntry("resolved", resolved)]);
		await fake.handlers.get("session_tree")!({}, fake.context);
		const resolvedUnfocused = await fake.handlers.get("before_agent_start")!({ systemPrompt: "base" }, fake.context);
		expect(resolvedUnfocused).toBeUndefined();
	});

	it("uses the concise resolution receipt for lightweight proposal acceptance", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Choose an approach" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		await fake.tool.execute("call", { action: "propose", id, record }, undefined, undefined, fake.context);
		const resolved = await fake.tool.execute("call", {
			action: "update",
			updates: [{ id, lifecycle: "resolved" }],
		}, undefined, undefined, fake.context);
		expect(resolved.content[0].text).toBe(`Decision \`${id}\` resolved: Use the narrow API.`);
	});

	it("formats generic update feedback while keeping updated IDs raw", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Choose an approach" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		const updated = await fake.tool.execute("call", {
			action: "update",
			updates: [{ id, point: "Choose the narrow approach" }],
		}, undefined, undefined, fake.context);

		expect(updated.content[0].text).toBe(`Updated \`${id}\`.`);
		expect(updated.details.updatedIds).toEqual([id]);
	});

	it("requires an explicit user request for agent removal", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Remove me" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;

		const refused = await fake.tool.execute("call", { action: "remove", ids: [id] }, undefined, undefined, fake.context);
		expect(refused.content[0].text).toContain("explicit user request");
		const removed = await fake.tool.execute("call", { action: "remove", ids: [id], userRequested: true }, undefined, undefined, fake.context);
		expect(removed.details.state.ledger.items).toEqual([]);
	});

	it("delivers /decisions export as full visible Markdown without triggering a model turn", async () => {
		const printFake = makeFakeExtension("print");
		await printFake.tool.execute("call", { action: "add", items: [{ point: "Print point" }] }, undefined, undefined, printFake.context);
		const printLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try {
			await printFake.commands.get("decisions")!.handler("export", printFake.context);
			expect(printLog).toHaveBeenCalledWith(expect.stringContaining("# Decision ledger export"));
		} finally {
			printLog.mockRestore();
		}

		for (const mode of ["tui", "rpc", "json"] as const) {
			const fake = makeFakeExtension(mode);
			await fake.tool.execute("call", { action: "add", items: [{ point: `${mode} point` }] }, undefined, undefined, fake.context);
			await fake.commands.get("decisions")!.handler("export", fake.context);
			expect(fake.pi.sendMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					customType: DECISION_EXPORT_MESSAGE_TYPE,
					content: expect.stringContaining(`${mode} point`),
					display: true,
				}),
				{ triggerTurn: false },
			);
		}
	});

	it("registers a Markdown renderer for TUI export messages", () => {
		const fake = makeFakeExtension("tui");

		expect(fake.pi.registerMessageRenderer).toHaveBeenCalledWith(DECISION_EXPORT_MESSAGE_TYPE, expect.any(Function));
	});

	it.each(["json", "rpc"] as const)("keeps export Markdown raw for client rendering in %s mode", async (mode) => {
		const fake = makeFakeExtension(mode);
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: `${mode} point` }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;

		await fake.commands.get("decisions")!.handler("export", fake.context);

		const [message, options] = fake.pi.sendMessage.mock.calls[0];
		expect(message).toEqual(expect.objectContaining({
			customType: DECISION_EXPORT_MESSAGE_TYPE,
			display: true,
		}));
		expect(message.content).toContain("# Decision ledger export");
		expect(message.content).toContain(`## Decision \`${id}\``);
		expect(message.content).toContain(`${mode} point`);
		expect(options).toEqual({ triggerTurn: false });
	});

	it("uses the selection highlight for every selected field while preserving ignored styling", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", {
			action: "add",
			items: [{ point: "Ignored point" }, { point: "Selected point" }],
		}, undefined, undefined, fake.context);
		const [ignoredId, selectedId] = added.details.state.ledger.items.map((item: { id: string }) => item.id);
		await fake.tool.execute("call", {
			action: "update",
			updates: [{ id: ignoredId, lifecycle: "ignored" }],
		}, undefined, undefined, fake.context);

		const ansi: Record<string, string> = {
			accent: "\x1b[35m",
			bold: "\x1b[1m",
			dim: "\x1b[2m",
			muted: "\x1b[36m",
			success: "\x1b[32m",
			warning: "\x1b[33m",
		};
		fake.context.ui.theme = {
			fg: (color: string, text: string) => `${ansi[color] ?? ""}${text}\x1b[39m`,
			bold: (text: string) => `${ansi.bold}${text}\x1b[22m`,
			strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
		};
		let component: { render: (width: number) => string[] } | undefined;
		fake.context.ui.custom.mockImplementation(async (factory: any) => {
			component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, vi.fn());
			return null;
		});
		await fake.commands.get("decisions")!.handler("", fake.context);

		const rows = component!.render(120);
		const selectedRow = rows.find((line) => line.includes(`→ [${selectedId}]`));
		const ignoredRow = rows.find((line) => line.includes(`[${ignoredId}]`));
		expect(selectedRow).toBeDefined();
		expect(selectedRow).toContain("\x1b[35m");
		expect(selectedRow).toContain("Selected point");
		expect(selectedRow).not.toContain("\x1b[2m");
		expect(selectedRow).not.toContain("\x1b[32m");
		expect(ignoredRow).toBeDefined();
		expect(ignoredRow).toContain("\x1b[2m");
		expect(ignoredRow).toContain("\x1b[9m");
	});

	it("preserves complete bracketed selector IDs at narrow widths with ANSI and wide Unicode", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", {
			action: "add",
			items: [{ title: "選択された日本語タイトル", point: "Complete point" }],
		}, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		const ansi: Record<string, string> = {
			accent: "\x1b[35m",
			bold: "\x1b[1m",
			dim: "\x1b[2m",
			muted: "\x1b[36m",
			success: "\x1b[32m",
			warning: "\x1b[33m",
		};
		fake.context.ui.theme = {
			fg: (color: string, text: string) => `${ansi[color] ?? ""}${text}\x1b[39m`,
			bold: (text: string) => `${ansi.bold}${text}\x1b[22m`,
			strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
		};

		let component: { render: (width: number) => string[] } | undefined;
		fake.context.ui.custom.mockImplementation(async (factory: any) => {
			component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, vi.fn());
			return null;
		});
		await fake.commands.get("decisions")!.handler("", fake.context);

		for (const width of [8, 80]) {
			const selectedRow = component!.render(width)
				.find((line) => stripTerminalSequences(line).startsWith(`→ [${id}]`));
			expect(selectedRow).toBeDefined();
			expect(stripTerminalSequences(selectedRow!)).toContain(`[${id}]`);
			expect(visibleWidth(selectedRow!)).toBeLessThanOrEqual(width);
			expect(selectedRow).toContain("\x1b[");
			if (width === 80) expect(stripTerminalSequences(selectedRow!)).toContain("日本語");
		}
	});

	it("keeps the widget actionable-only while progress counts every current item", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", {
			action: "add",
			items: [{ point: "Open" }, { point: "Resolved" }, { point: "Ignored" }, { point: "Deferred" }],
		}, undefined, undefined, fake.context);
		const ids = added.details.state.ledger.items.map((item: { id: string }) => item.id);
		await fake.tool.execute("call", { action: "update", updates: [
			{ id: ids[1], lifecycle: "resolved" },
			{ id: ids[2], lifecycle: "ignored" },
			{ id: ids[3], lifecycle: "deferred" },
		] }, undefined, undefined, fake.context);
		const renderWidget = (): string[] => {
			const factory = fake.context.ui.setWidget.mock.calls.at(-1)?.[1] as (tui: unknown, theme: unknown) => { render: (width: number) => string[] };
			return factory({}, fake.context.ui.theme).render(80);
		};
		let lines = renderWidget();
		expect(lines[0]).toBe("<accent>Decisions: 2/4 completed</accent>");
		expect(lines.join("\\n")).toContain(ids[0]);
		expect(lines.join("\\n")).not.toContain(ids[1]);
		expect(lines.join("\\n")).not.toContain(ids[2]);
		expect(lines.join("\\n")).not.toContain(ids[3]);

		await fake.tool.execute("call", { action: "update", updates: [{ id: ids[0], lifecycle: "ignored" }] }, undefined, undefined, fake.context);
		lines = renderWidget();
		expect(lines[0]).toBe("<accent>Decisions: 3/4 completed</accent>");
		await fake.tool.execute("call", { action: "update", updates: [{ id: ids[3], lifecycle: "open" }] }, undefined, undefined, fake.context);
		await fake.tool.execute("call", { action: "update", updates: [{ id: ids[3], lifecycle: "ignored" }] }, undefined, undefined, fake.context);
		lines = renderWidget();
		expect(lines).toEqual(["<success>Decisions: 4/4 completed</success>"]);
	});

	it("handles selector shortcuts, confirmation cancellation, invalid actions, and delete encoding", async () => {
		expect(matchesKey("\x1b[3~", "delete")).toBe(true);
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Choose" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		const components: Array<{ handleInput: (data: string) => void }> = [];
		fake.context.ui.confirm.mockResolvedValue(false);
		let cancelSelectorCalls = 0;
		fake.context.ui.custom.mockImplementation(async (factory: any) => {
			cancelSelectorCalls += 1;
			if (cancelSelectorCalls > 1) return null;
			return new Promise((resolve) => {
				const component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, resolve);
				components.push(component);
			});
		});
		const cancelled = fake.commands.get("decisions")!.handler("", fake.context);
		await Promise.resolve();
		components[0]!.handleInput("i");
		await cancelled;
		expect(fake.context.ui.notify).toHaveBeenCalledWith("Ignore cancelled.", "info");
		expect((await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context)).details.state.ledger.items[0].lifecycle).toBe("open");

		components.length = 0;
		let invalidSelectorCalls = 0;
		fake.context.ui.custom.mockImplementation(async (factory: any) => {
			invalidSelectorCalls += 1;
			if (invalidSelectorCalls > 2) return null;
			return new Promise((resolve) => {
				const component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, resolve);
				components.push(component);
			});
		});
		const invalid = fake.commands.get("decisions")!.handler("", fake.context);
		await Promise.resolve();
		components[0]!.handleInput("r");
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(fake.context.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not terminal"), "warning");
		components[1]!.handleInput("?");
		await invalid;
		expect(fake.context.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Keys:"), "info");

		fake.context.ui.confirm.mockResolvedValue(true);
		components.length = 0;
		fake.context.ui.custom.mockImplementation(async (factory: any) => new Promise((resolve) => {
			const component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, resolve);
			components.push(component);
		}));
		const removed = fake.commands.get("decisions")!.handler("", fake.context);
		await Promise.resolve();
		components[0]!.handleInput("\x1b[3~");
		await removed;
		expect((await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context)).details.state.ledger.items).toEqual([]);
	});

	it("keeps the full selector complete and orders open first and ignored last", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", {
			action: "add",
			items: [{ point: "Ignored" }, { point: "Open" }, { point: "Deferred" }, { point: "Resolved" }],
		}, undefined, undefined, fake.context);
		const ids = added.details.state.ledger.items.map((item: { id: string }) => item.id);
		await fake.tool.execute("call", { action: "update", updates: [
			{ id: ids[0], lifecycle: "ignored" },
			{ id: ids[2], lifecycle: "deferred" },
			{ id: ids[3], lifecycle: "resolved" },
		] }, undefined, undefined, fake.context);
		let component: { render: (width: number) => string[] } | undefined;
		fake.context.ui.custom.mockImplementation(async (factory: any) => {
			component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, vi.fn());
			return null;
		});
		await fake.commands.get("decisions")!.handler("", fake.context);
		const rendered = component!.render(160).join("\\n");
		for (const id of ids) expect(rendered).toContain(id);
		expect(rendered.indexOf(ids[1]!)).toBeLessThan(rendered.indexOf(ids[0]!));
		expect(rendered.indexOf(ids[0]!)).toBeGreaterThan(rendered.indexOf(ids[3]!));
	});

	it("runs explore, defer, and reopen selector shortcuts through shared transitions", async () => {
		const fake = makeFakeExtension();
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Choose" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		const press = async (key: string): Promise<void> => {
			let component: { handleInput: (data: string) => void } | undefined;
			fake.context.ui.custom.mockImplementationOnce(async (factory: any) => new Promise((resolve) => {
				component = factory({ requestRender: vi.fn() }, fake.context.ui.theme, {}, resolve);
			}));
			const command = fake.commands.get("decisions")!.handler("", fake.context);
			await new Promise<void>((resolve) => setImmediate(resolve));
			component!.handleInput(key);
			await command;
		};

		await press("e");
		let listed = await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context);
		expect(listed.details.state.ledger.items[0].lifecycle).toBe("exploring");
		await fake.commands.get("decision")!.handler("exit", fake.context);
		await press("f");
		listed = await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context);
		expect(listed.details.state.ledger.items[0].lifecycle).toBe("deferred");
		await press("r");
		listed = await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context);
		expect(listed.details.state.ledger.items[0].lifecycle).toBe("open");
	});

	it("accepts lightweight proposals and routes explored proposals through review and return", async () => {
		const lightweight = makeFakeExtension();
		const added = await lightweight.tool.execute("call", { action: "add", items: [{ point: "Choose" }] }, undefined, undefined, lightweight.context);
		const id = added.details.state.ledger.items[0].id;
		await lightweight.tool.execute("call", { action: "propose", id, record }, undefined, undefined, lightweight.context);
		lightweight.context.ui.confirm.mockResolvedValue(true);
		let component: { handleInput: (data: string) => void } | undefined;
		lightweight.context.ui.custom.mockImplementation(async (factory: any) => new Promise((resolve) => {
			component = factory({ requestRender: vi.fn() }, lightweight.context.ui.theme, {}, resolve);
		}));
		const command = lightweight.commands.get("decisions")!.handler("", lightweight.context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		component!.handleInput("a");
		await command;
		const accepted = await lightweight.tool.execute("call", { action: "list" }, undefined, undefined, lightweight.context);
		expect(accepted.details.state.ledger.items[0].lifecycle).toBe("resolved");
		expect(accepted.details.state.ledger.items[0].record).toEqual(record);

		const explored = makeFakeExtension();
		explored.setEntries([messageEntry("prior", "assistant"), messageEntry("trigger", "user"), messageEntry("tool-call", "assistant")]);
		const exploredAdded = await explored.tool.execute("call", { action: "add", items: [{ point: "Investigate" }] }, undefined, undefined, explored.context);
		const exploredId = exploredAdded.details.state.ledger.items[0].id;
		await explored.tool.execute("call", { action: "propose", id: exploredId, record }, undefined, undefined, explored.context);
		await explored.tool.execute("call", { action: "explore", id: exploredId }, undefined, undefined, explored.context);
		explored.context.ui.confirm.mockResolvedValue(true);
		explored.context.ui.editor.mockResolvedValue(renderDecisionRecordMarkdown({ id: exploredId, point: "Investigate" }, record));
		let exploredComponent: { handleInput: (data: string) => void } | undefined;
		explored.context.ui.custom.mockImplementation(async (factory: any) => new Promise((resolve) => {
			exploredComponent = factory({ requestRender: vi.fn() }, explored.context.ui.theme, {}, resolve);
		}));
		const exploredCommand = explored.commands.get("decisions")!.handler("", explored.context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		exploredComponent!.handleInput("a");
		await exploredCommand;
		const resolved = await explored.tool.execute("call", { action: "list" }, undefined, undefined, explored.context);
		expect(resolved.details.state.ledger.items[0].lifecycle).toBe("resolved");
	});

	it("selects the focused item's exact draft across lightweight proposal switching and cancellation", async () => {
		const fake = makeFakeExtension();
		fake.setEntries([messageEntry("prior", "assistant"), messageEntry("trigger", "user"), messageEntry("tool-call", "assistant")]);
		const added = await fake.tool.execute("call", {
			action: "add",
			items: [{ point: "Investigate A" }, { point: "Investigate B" }],
		}, undefined, undefined, fake.context);
		const [idA, idB] = added.details.state.ledger.items.map((item: { id: string }) => item.id);
		const recordA = { ...record, decision: "Use approach A." };
		const recordB = { ...record, decision: "Use approach B." };
		const markdownA = renderDecisionRecordMarkdown({ id: idA, point: "Investigate A" }, recordA);

		await fake.tool.execute("call", { action: "propose", id: idA, record: recordA }, undefined, undefined, fake.context);
		await fake.tool.execute("call", { action: "propose", id: idB, record: recordB }, undefined, undefined, fake.context);
		await fake.tool.execute("call", { action: "explore", id: idA }, undefined, undefined, fake.context);
		await fake.commands.get("decision")!.handler("exit", fake.context);
		await fake.commands.get("decision")!.handler(`explore ${idB}`, fake.context);
		await fake.commands.get("decision")!.handler(`explore ${idA}`, fake.context);

		fake.context.ui.editor.mockResolvedValueOnce(undefined).mockResolvedValue(markdownA);
		await fake.commands.get("decision")!.handler("return", fake.context);
		expect(fake.context.ui.editor).toHaveBeenCalledWith(`Review decision record [${idA}]`, markdownA);
		const cancelled = await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context);
		expect(cancelled.details.state.ledger.items.find((item: { id: string }) => item.id === idA)?.lifecycle).toBe("exploring");

		await fake.commands.get("decision")!.handler("return", fake.context);
		const resolved = await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context);
		expect(resolved.details.state.ledger.items.find((item: { id: string }) => item.id === idA)?.lifecycle).toBe("resolved");
		expect(resolved.details.state.ledger.items.find((item: { id: string }) => item.id === idB)?.record).toEqual(recordB);
	});

	it("persists the exact reviewed draft once and requests only complementary handoff context", async () => {
		const fake = makeFakeExtension();
		fake.setEntries([messageEntry("prior", "assistant"), messageEntry("trigger", "user"), messageEntry("tool-call", "assistant")]);
		const added = await fake.tool.execute("call", { action: "add", items: [{ title: "Choose API", point: "Investigate" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		await fake.tool.execute("call", { action: "explore", id }, undefined, undefined, fake.context);
		await fake.tool.execute("call", { action: "propose", id, record }, undefined, undefined, fake.context);
		const markdown = renderDecisionRecordMarkdown({ id, title: "Choose API", point: "Investigate" }, record);
		fake.context.ui.editor.mockResolvedValue(markdown);
		fake.context.navigateTree.mockImplementation(async (_target: string, options: any) => {
			expect(options.summarize).toBe(true);
			expect(options.replaceInstructions).toBe(true);
			expect(options.customInstructions).toContain("additional concrete evidence or references");
			expect(options.customInstructions).not.toContain(record.decision);
			expect(options.customInstructions).not.toContain(record.context);
		return { cancelled: true };
		});

		await fake.commands.get("decision")!.handler("return", fake.context);
		const reviewMessages = fake.pi.sendMessage.mock.calls.filter(([message]: [any]) => message.customType === REVIEW_DRAFT_MESSAGE_TYPE);
		expect(reviewMessages).toHaveLength(1);
		expect(reviewMessages[0]![0]).toEqual(expect.objectContaining({ content: markdown, display: false, details: { itemId: id, markdown } }));
		expect(reviewMessages[0]![1]).toEqual({ triggerTurn: false });
		const cancelled = await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context);
		expect(cancelled.details.state.ledger.items[0].lifecycle).toBe("proposed");
		expect(cancelled.details.state.ledger.items[0].proposalMarkdown).toBe(markdown);

		await fake.commands.get("decision")!.handler("return", fake.context);
		const repeatedReviewMessages = fake.pi.sendMessage.mock.calls.filter(([message]: [any]) => message.customType === REVIEW_DRAFT_MESSAGE_TYPE);
		expect(repeatedReviewMessages).toHaveLength(1);
	});

	it.each([
		["cancelled navigation", { cancelled: true }],
		["rejected navigation", new Error("navigation failed")],
	] as const)("durably restores the proposal after %s changes the active branch", async (_name, navigationResult) => {
		const fake = makeFakeExtension();
		fake.setEntries([messageEntry("prior", "assistant"), messageEntry("trigger", "user"), messageEntry("tool-call", "assistant")]);
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Investigate" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		await fake.tool.execute("call", { action: "explore", id }, undefined, undefined, fake.context);
		await fake.tool.execute("call", { action: "propose", id, record }, undefined, undefined, fake.context);
		const markdown = renderDecisionRecordMarkdown({ id, point: "Investigate" }, record);
		fake.context.ui.editor.mockResolvedValue(markdown);
		fake.context.navigateTree.mockImplementation(async () => {
			fake.setEntries([customEntry("destination", emptyLedgerState())]);
			await fake.handlers.get("session_tree")!({ newLeafId: "destination", oldLeafId: "tool-call" }, fake.context);
			if (navigationResult instanceof Error) throw navigationResult;
			return navigationResult;
		});
		fake.pi.appendEntry.mockClear();

		await fake.commands.get("decision")!.handler("return", fake.context);
		expect(fake.pi.appendEntry).toHaveBeenCalledTimes(2);
		const rollbackEntry = fake.getEntries().at(-1) as { id: string; data: { source: string; state: LedgerState } };
		expect(rollbackEntry.data.source).toBe("navigation_rollback");

		// The next tree event must replay the recorded destination branch rather
		// than relying on the original extension closure.
		await fake.handlers.get("session_tree")!({ newLeafId: rollbackEntry.id, oldLeafId: "destination" }, fake.context);
		const replayed = await fake.tool.execute("call", { action: "list" }, undefined, undefined, fake.context);
		const replayedItem = replayed.details.state.ledger.items.find((item: { id: string }) => item.id === id);
		expect(replayedItem.lifecycle).toBe("proposed");
		expect(replayedItem.proposalMarkdown).toBe(markdown);
		expect(replayedItem.exploration).toEqual({
			returnEntryId: "prior",
			returnLabel: `decision-return-${id}`,
			origin: "open",
		});
		expect(replayed.details.state.proposal).toEqual({ itemId: id, record, markdown });

		// Recreate the extension from the actual recorded entries as reload does.
		const reloaded = makeFakeExtension();
		reloaded.setEntries(fake.getEntries());
		await reloaded.handlers.get("session_start")!({ reason: "reload" }, reloaded.context);
		const restored = await reloaded.tool.execute("call", { action: "list" }, undefined, undefined, reloaded.context);
		const restoredItem = restored.details.state.ledger.items.find((item: { id: string }) => item.id === id);
		expect(restoredItem.lifecycle).toBe("proposed");
		expect(restoredItem.proposalMarkdown).toBe(markdown);
		expect(restoredItem.exploration?.origin).toBe("open");
		expect(restoredItem.exploration?.returnLabel).toBe(`decision-return-${id}`);
		expect(restored.details.state.proposal?.markdown).toBe(markdown);
	});

	it("uses the native follow-up loader path and cleans it on settlement", async () => {
		const fake = makeFakeExtension();
		const prior = messageEntry("prior", "assistant");
		const trigger = messageEntry("trigger", "user");
		const toolCall = messageEntry("tool-call", "assistant");
		fake.setEntries([prior, trigger, toolCall]);
		const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Choose an approach" }] }, undefined, undefined, fake.context);
		const id = added.details.state.ledger.items[0].id;
		await fake.tool.execute("call", { action: "explore", id }, undefined, undefined, fake.context);
		const markdown = renderDecisionRecordMarkdown({ id, point: "Choose an approach" }, record);
		await fake.tool.execute("call", { action: "propose", id, record }, undefined, undefined, fake.context);
		fake.context.ui.editor.mockResolvedValue(markdown);
		fake.context.isIdle.mockReturnValue(false);
		fake.setLeaf("tip");
		fake.setEntries([prior, trigger, toolCall]);
		fake.context.navigateTree.mockImplementation(async () => {
			await fake.handlers.get("session_tree")!({}, fake.context);
			return { cancelled: false };
		});
		const navigationContext = { ...fake.context, sessionManager: { ...fake.context.sessionManager, getLeafId: () => "tip" } };
		await fake.commands.get("decision")!.handler("return", navigationContext);

		expect(fake.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: `Decision \`${id}\` resolved: Use the narrow API.` }), { triggerTurn: true, deliverAs: "followUp" });
		expect(fake.context.ui.setWorkingIndicator).toHaveBeenCalledWith();
		await fake.handlers.get("agent_settled")!({}, fake.context);
		expect(fake.context.ui.setWorkingMessage).toHaveBeenCalledWith();
		expect(fake.context.ui.setWorkingVisible).toHaveBeenCalledWith(true);
	});

	it("installs return progress before persistence and clears it through the latest tree context", async () => {
		vi.useFakeTimers();
		try {
			const fake = makeFakeExtension();
			const prior = messageEntry("prior", "assistant");
			const trigger = messageEntry("trigger", "user");
			const toolCall = messageEntry("tool-call", "assistant");
			fake.setEntries([prior, trigger, toolCall]);
			const added = await fake.tool.execute("call", { action: "add", items: [{ point: "Investigate" }] }, undefined, undefined, fake.context);
			const id = added.details.state.ledger.items[0].id;
			await fake.tool.execute("call", { action: "explore", id }, undefined, undefined, fake.context);
			await fake.tool.execute("call", { action: "propose", id, record }, undefined, undefined, fake.context);
			const markdown = renderDecisionRecordMarkdown({ id, point: "Investigate" }, record);
			fake.context.ui.editor.mockResolvedValue(markdown);
			let progressWidget: { dispose: () => void } | undefined;
			const progressUi = fake.context.ui;
			progressUi.setWidget.mockImplementation((key: string, content: unknown) => {
				if (key === "decision-ledger-return-progress" && typeof content === "function") {
					progressWidget = (content as (tui: unknown, theme: unknown) => { dispose: () => void })(
						{ requestRender: vi.fn() },
						progressUi.theme,
					);
				}
			});
			const destinationUi = { ...progressUi, setWidget: vi.fn() };
			const destinationContext = { ...fake.context, ui: destinationUi };
			fake.context.navigateTree.mockImplementation(async () => {
				await fake.handlers.get("session_tree")!({}, destinationContext);
				return { cancelled: true };
			});

			await fake.commands.get("decision")!.handler("return", fake.context);
			const progressCall = progressUi.setWidget.mock.invocationCallOrder.find((_, index) =>
				progressUi.setWidget.mock.calls[index]?.[0] === "decision-ledger-return-progress" && progressUi.setWidget.mock.calls[index]?.[1] !== undefined,
			);
			const firstPersistenceAfterProgress = fake.pi.appendEntry.mock.invocationCallOrder.find((order: number) => progressCall !== undefined && order > progressCall);
			expect(progressCall).toBeDefined();
			expect(firstPersistenceAfterProgress).toBeDefined();
			expect(destinationUi.setWidget).toHaveBeenCalledWith("decision-ledger-return-progress", undefined);
			expect(progressWidget).toBeDefined();
			progressWidget!.dispose();
			vi.advanceTimersByTime(500);
		} finally {
			vi.useRealTimers();
		}
	});

	it("records one durable transition per focus action and one live final marker per call", async () => {
		const fake = makeFakeExtension();
		fake.setEntries([messageEntry("prior", "assistant"), messageEntry("trigger", "user"), messageEntry("tool-call", "assistant")]);
		const added = await fake.tool.execute("call", { action: "add", items: [
			{ title: "First choice", point: "Investigate first choice fully" },
			{ title: "Second choice", point: "Investigate second choice fully" },
		] }, undefined, undefined, fake.context);
		const [firstId, secondId] = added.details.state.ledger.items.map((item: { id: string }) => item.id);
		await fake.tool.execute("call", { action: "explore", id: firstId }, undefined, undefined, fake.context);
		const started = fake.pi.sendMessage.mock.calls.filter(([message]: [any]) => message.customType === FOCUS_TRANSITION_MESSAGE_TYPE);
		expect(started).toHaveLength(1);
		expect(started[0]![0].content).toContain("`" + firstId + "`");
		expect(started[0]![0].content).toContain("First choice");
		expect(started[0]![0].content).toContain("Investigate first choice fully");

		const firstContext = await fake.handlers.get("context")!({
			messages: [
				{ role: "custom", customType: FOCUS_MARKER_MESSAGE_TYPE, content: "stale", display: false, timestamp: 1 },
				{ role: "user", content: "Can you continue this?", timestamp: 2 },
			],
		}, fake.context) as any;
		const firstMarkers = firstContext.messages.filter((message: any) => message.customType === FOCUS_MARKER_MESSAGE_TYPE);
		expect(firstMarkers).toHaveLength(1);
		expect(firstMarkers[0].content).toContain("`" + firstId + "`");
		expect(firstMarkers[0].content).toContain("First choice");
		expect(firstMarkers[0].content).toContain("Investigate first choice fully");
		expect(firstMarkers[0].content).toContain("this, it, the decision, and the proposal");
		expect(firstMarkers[0].content).toContain("recently resolved decision does not regain focus");

		await fake.commands.get("decision")!.handler(`explore ${secondId}`, fake.context);
		const transitions = fake.pi.sendMessage.mock.calls.filter(([message]: [any]) => message.customType === FOCUS_TRANSITION_MESSAGE_TYPE);
		expect(transitions).toHaveLength(2);
		expect(transitions[1]![0].content).toContain("`" + secondId + "`");
		await fake.commands.get("decision")!.handler("exit", fake.context);
		const afterExit = fake.pi.sendMessage.mock.calls.filter(([message]: [any]) => message.customType === FOCUS_TRANSITION_MESSAGE_TYPE);
		expect(afterExit).toHaveLength(3);
		expect(afterExit[2]![0].content).toContain("cleared");

		const afterExitContext = await fake.handlers.get("context")!({ messages: firstContext.messages }, fake.context) as any;
		const remainingMarkers = afterExitContext?.messages?.filter((message: any) => message.customType === FOCUS_MARKER_MESSAGE_TYPE) ?? [];
		expect(remainingMarkers).toHaveLength(0);
	});

	it("intercepts forced decision completion without affecting external paths", async () => {
		const fake = makeFakeExtension();
		const addAutocompleteProvider = vi.fn();
		(fake.context.ui as any).addAutocompleteProvider = addAutocompleteProvider;
		const base = {
			getSuggestions: vi.fn(async () => ({ items: [{ value: "path", label: "path" }], prefix: "./" })),
			applyCompletion: vi.fn((lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol })),
			shouldTriggerFileCompletion: vi.fn(() => true),
		};
		addAutocompleteProvider.mockImplementation((factory: any) => factory(base));
		const snapshot: LedgerState = { ledger: { items: [
			{ id: "ABC", title: "Choose API", point: "Choose an API", lifecycle: "open" },
			{ id: "D1", title: "Legacy choice", point: "Choose legacy", lifecycle: "open" },
			{ id: "XYZ", title: "Confirm rollout", point: "Confirm rollout", lifecycle: "open" },
		] } };
		fake.setEntries([customEntry("state", snapshot)]);
		await fake.handlers.get("session_start")!({ reason: "reload" }, fake.context);
		await fake.handlers.get("session_start")!({ reason: "reload" }, fake.context);
		expect(addAutocompleteProvider).toHaveBeenCalledTimes(1);
		await fake.handlers.get("session_shutdown")!({ reason: "reload" }, fake.context);
		await fake.handlers.get("session_start")!({ reason: "reload" }, fake.context);
		expect(addAutocompleteProvider).toHaveBeenCalledTimes(2);
		const wrapper = addAutocompleteProvider.mock.results[0]!.value;
		const signal = new AbortController().signal;
		const re = await wrapper.getSuggestions(["/decision re"], 0, 12, { force: true, signal });
		expect(re?.items.map((item: any) => item.value)).toEqual(["return", "remove"]);
		expect(re?.items.every((item: any) => !item.value.includes("["))).toBe(true);
		const ids = await wrapper.getSuggestions(["/decision explore "], 0, 19, { force: true, signal });
		expect(ids?.items.map((item: any) => item.value)).toEqual(["ABC", "D1", "XYZ"]);
		expect(ids?.items.find((item: any) => item.value === "D1")).toMatchObject({ label: "[D1]", description: "Legacy choice" });
		const removeIds = await wrapper.getSuggestions(["/decision remove ABC "], 0, 21, { force: true, signal });
		expect(removeIds?.items.map((item: any) => item.value)).toEqual(["D1", "XYZ"]);
		expect(await wrapper.getSuggestions(["/decision explore Q"], 0, 20, { force: true, signal })).toBeNull();
		expect(wrapper.shouldTriggerFileCompletion(["/decision explore "], 0, 19)).toBe(false);
		const applied = wrapper.applyCompletion(["/decision explore d"], 0, 19, { value: "D1", label: "[D1]" }, "d");
		expect(applied.lines[0]).toBe("/decision explore D1");
		await wrapper.getSuggestions(["./"], 0, 2, { force: true, signal });
		expect(wrapper.shouldTriggerFileCompletion(["./"], 0, 2)).toBe(true);
		expect(base.getSuggestions).toHaveBeenCalled();
		expect(base.shouldTriggerFileCompletion).toHaveBeenCalledWith(["./"], 0, 2);
	});
});
