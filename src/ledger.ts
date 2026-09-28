import { randomBytes } from "node:crypto";
import { importDurableAdr } from "./durable.ts";

export const TOOL_NAME = "decision_ledger";
export const CUSTOM_ENTRY_TYPE = "pi-decision-ledger";
export const RETURN_RECEIPT_MESSAGE_TYPE = "pi-decision-ledger-return";
export const DECISION_OVERVIEW_MESSAGE_TYPE = "pi-decision-ledger-overview";
export const DECISION_EXPORT_MESSAGE_TYPE = "pi-decision-ledger-export";
export const REVIEW_DRAFT_MESSAGE_TYPE = "pi-decision-ledger-review-draft";
export const FOCUS_TRANSITION_MESSAGE_TYPE = "pi-decision-ledger-focus-transition";
export const FOCUS_MARKER_MESSAGE_TYPE = "pi-decision-ledger-focus-marker";
export const ADR_EDIT_MESSAGE_TYPE = "pi-decision-ledger-adr-edit";

export const DECISION_COMMANDS = ["capture", "explore", "promote", "remove", "return", "exit"] as const;

/** Subcommands that take decision IDs, and whether they take more than one. */
export const DECISION_ID_COMMANDS: Record<string, "single" | "multiple"> = {
	explore: "single",
	promote: "multiple",
	remove: "multiple",
};
export const DECISIONS_COMMANDS = ["new", "recover", "export"] as const;

export const DECISION_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const DECISION_ID_LENGTH = 3;
export const MAX_DECISION_ID_ATTEMPTS = 128;
export const MAX_RANDOM_BYTE_ATTEMPTS = 128;

export const LIFECYCLES = ["open", "proposed", "resolved", "deferred", "ignored"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

/** Lifecycles that can be declared when an item is added. Exploration needs a live bookmark. */
export const INITIAL_LIFECYCLES = ["open", "proposed", "resolved", "deferred", "ignored"] as const;
export type InitialLifecycle = (typeof INITIAL_LIFECYCLES)[number];

export type ExplorationOrigin = "open" | "proposed";

export interface DecisionRecord {
	decision: string;
	context: string;
	optionsConsidered: string[];
	consequences: string;
	followUps: string[];
}

export interface Exploration {
	returnEntryId: string;
	returnLabel: string;
	/** Legacy/audit metadata describing the lifecycle when focus began; exit never restores from it. */
	origin: ExplorationOrigin;
}

/**
 * Provenance for a session decision promoted to a repository ADR draft. The
 * repository file is authoritative once this exists; everything held here is a
 * working copy, frozen at promotion time.
 */
export interface DurablePromotion {
	/** Durable ADR UUIDv4. */
	adrId: string;
	/** Stable repository-local human handle used by ADR commands. */
	slug: string;
	repositoryRoot: string;
	relativePath: string;
	lifecycle: "draft" | "accepted" | "superseded";
	baseSemanticDigest: string;
	baseSourceFingerprint: string;
	/** Exact checked-out source used for optimistic conflict detection. */
	baseSource: string;
	/** Every session decision promoted into this ADR, in the order given. */
	sourceDecisionIds: string[];
}

export interface DecisionItem {
	id: string;
	/** A short stable display title. Legacy snapshots may omit it. */
	title?: string;
	point: string;
	lifecycle: Lifecycle;
	record?: DecisionRecord;
	/** The exact Markdown draft for this item's lightweight or explored proposal. */
	proposalMarkdown?: string;
	exploration?: Exploration;
	/** Stable identity of the registry-owned ADR associated with this decision. */
	adrId?: string;
}

export interface DecisionLedger {
	items: DecisionItem[];
	/** Kept for loading legacy snapshots; new IDs never use this counter. */
	nextId?: number;
	/** IDs allocated in this session, including items removed from the current branch. */
	usedIds?: string[];
}

export interface DecisionProposal {
	itemId: string;
	record: DecisionRecord;
	markdown: string;
}

export interface LedgerState {
	ledger?: DecisionLedger;
	proposal?: DecisionProposal;
	/** First-class repository ADR working copies, independent of source decisions. */
	adrs?: DurablePromotion[];
}

export interface AddDecisionItemInput {
	/** Required by the public tool schema; omitted only for legacy callers. */
	title?: string;
	point: string;
	/** Omitted defaults to open. Exploring requires a live /decision explore bookmark. */
	lifecycle?: InitialLifecycle;
	/** Required for proposed, resolved, and ignored; optional for deferred; forbidden for open. */
	record?: DecisionRecord;
}

export type RandomBytesSource = (size: number) => Uint8Array;

export interface AddDecisionItemsOptions {
	/** IDs found in session history, including snapshots on other branches. */
	reservedIds?: Iterable<string>;
	randomBytes?: RandomBytesSource;
	maxAttempts?: number;
}

export interface DecisionUpdateInput {
	id: string;
	title?: string;
	point?: string;
}

export interface LedgerSessionDetails {
	extension: typeof CUSTOM_ENTRY_TYPE;
	version: 1;
	action: "list" | "detail" | "add" | "update" | "explore" | "propose" | "resolve" | "accept" | "reject" | "defer" | "ignore" | "reopen" | "remove" | "promote_adr";
	state: LedgerState;
	addedIds?: string[];
	updatedIds?: string[];
	returnEntryId?: string;
	returnLabel?: string;
	error?: string;
}

export interface LedgerCustomEntryData {
	extension: typeof CUSTOM_ENTRY_TYPE;
	version: 1;
	source: "command" | "recovery" | "fork_reset" | "navigation_rollback" | "session_handoff";
	state: LedgerState;
}

export interface LedgerEntryLike {
	type?: unknown;
	id?: unknown;
	timestamp?: unknown;
	customType?: unknown;
	data?: unknown;
	message?: unknown;
}

export interface OffBranchSnapshot {
	entryId: string;
	timestamp?: string;
	state: LedgerState;
}

export interface CompletionItem {
	value: string;
	label: string;
	description?: string;
}

export type DecisionIdDisplayContext = "markdown" | "tui";

/** Format an ID for a human-facing Markdown/prose or interactive TUI surface. */
export function formatDecisionId(id: string, context: DecisionIdDisplayContext = "markdown"): string {
	if (context === "tui") return `[${id}]`;
	const runs = id.match(/`+/g) ?? [];
	const longestRun = runs.reduce((longest, run) => Math.max(longest, run.length), 0);
	const fence = "`".repeat(longestRun + 1);
	const body = /^[\s`]|[\s`]$/.test(id) ? ` ${id} ` : id;
	return `${fence}${body}${fence}`;
}

/** Delimiters used by interactive TUI surfaces; styling is applied by callers. */
export function formatDecisionIdForTui(id: string): string {
	return formatDecisionId(id, "tui");
}

/** Use the stored title, falling back to the complete point for legacy items. */
export function decisionDisplayTitle(item: Pick<DecisionItem, "title" | "point">): string {
	return item.title?.trim() || item.point;
}

/** Compact durable badge, kept separate from the session lifecycle. */
export function durableBadge(item: Pick<DecisionItem, "adrId">, state: LedgerState): string | undefined {
	const adr = state.adrs?.find((candidate) => candidate.adrId === item.adrId);
	return adr === undefined ? undefined : `ADR ${adr.lifecycle}`;
}

function durableDetailLines(durable: DurablePromotion, bullet: string): string[] {
	return [
		`${bullet}ADR lifecycle: **${durable.lifecycle}** (the repository file is authoritative)`,
		`${bullet}ADR slug: \`${durable.slug}\``,
		`${bullet}ADR ID: \`${durable.adrId}\``,
		`${bullet}ADR file: \`${durable.relativePath}\` in \`${durable.repositoryRoot}\``,
		`${bullet}ADR sources: ${durable.sourceDecisionIds.map((id) => formatDecisionId(id)).join(", ")}`,
	];
}

export interface DecisionStatePresentation {
	symbol: "○" | "◉" | "◇" | "✓" | "⏸" | "−";
	kind: Lifecycle;
	focused: boolean;
	ignored: boolean;
	dimmed: boolean;
	bold: boolean;
}

export function isDecisionId(id: string): boolean {
	return /^[A-Z0-9]{3}$/.test(id) || /^D[1-9]\d*$/.test(id);
}

export function normalizeDecisionId(id: string): string {
	const normalized = id.trim().toUpperCase();
	if (!isDecisionId(normalized)) throw new Error(`invalid decision ID: ${id}`);
	return normalized;
}

export function decisionStatePresentation(item: Pick<DecisionItem, "lifecycle" | "exploration">): DecisionStatePresentation {
	switch (item.lifecycle) {
		case "open":
			return { symbol: item.exploration === undefined ? "○" : "◉", kind: item.lifecycle, focused: item.exploration !== undefined, ignored: false, dimmed: false, bold: item.exploration !== undefined };
		case "proposed":
			return { symbol: item.exploration === undefined ? "◇" : "◉", kind: item.lifecycle, focused: item.exploration !== undefined, ignored: false, dimmed: false, bold: item.exploration !== undefined };
		case "resolved":
			return { symbol: "✓", kind: item.lifecycle, focused: false, ignored: false, dimmed: true, bold: false };
		case "deferred":
			return { symbol: "⏸", kind: item.lifecycle, focused: false, ignored: false, dimmed: true, bold: false };
		case "ignored":
			return { symbol: "−", kind: item.lifecycle, focused: false, ignored: true, dimmed: true, bold: false };
	}
}

export function isDecisionCompleted(item: Pick<DecisionItem, "lifecycle">): boolean {
	return item.lifecycle === "resolved" || item.lifecycle === "ignored";
}

export function isDecisionUnresolved(item: Pick<DecisionItem, "lifecycle">): boolean {
	return !isDecisionCompleted(item);
}

export function isDecisionActionable(item: Pick<DecisionItem, "lifecycle">): boolean {
	return item.lifecycle === "open" || item.lifecycle === "proposed";
}

export interface DecisionProgress {
	completed: number;
	total: number;
}

export function decisionProgress(state: LedgerState): DecisionProgress {
	const items = state.ledger?.items ?? [];
	return {
		completed: items.filter(isDecisionCompleted).length,
		total: items.length,
	};
}

/**
 * Return a display-only ordering with open decisions first and ignored
 * decisions last. Stable relative ordering within each group is preserved.
 */
export function orderDecisionItems<T extends Pick<DecisionItem, "lifecycle">>(items: readonly T[]): T[] {
	const rank = (item: T): number => item.lifecycle === "open" ? 0 : item.lifecycle === "ignored" ? 2 : 1;
	return items
		.map((item, index) => ({ item, index }))
		.sort((left, right) => rank(left.item) - rank(right.item) || left.index - right.index)
		.map(({ item }) => item);
}

/**
 * Return only rows useful for the bottom session widget. This is deliberately
 * separate from orderDecisionItems because /decisions must remain complete.
 */
export function orderActionableDecisionItems<T extends Pick<DecisionItem, "lifecycle">>(items: readonly T[]): T[] {
	const rank = (item: T): number => item.lifecycle === "open" ? 0 : 1;
	return items
		.filter(isDecisionActionable)
		.map((item, index) => ({ item, index }))
		.sort((left, right) => rank(left.item) - rank(right.item) || left.index - right.index)
		.map(({ item }) => item);
}

export type DecisionOverviewDelivery = "notify" | "print" | "message";
export type DecisionExportDelivery = "print" | "message";

export function decisionExportDelivery(mode: "tui" | "rpc" | "json" | "print"): DecisionExportDelivery {
	return mode === "print" ? "print" : "message";
}

export function decisionOverviewDelivery(
	mode: "tui" | "rpc" | "json" | "print",
	hasUI: boolean,
): DecisionOverviewDelivery {
	if (hasUI) return "notify";
	return mode === "print" ? "print" : "message";
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function cloneRecord(record: DecisionRecord): DecisionRecord {
	return {
		decision: record.decision,
		context: record.context,
		optionsConsidered: [...record.optionsConsidered],
		consequences: record.consequences,
		followUps: [...record.followUps],
	};
}

function cloneItem(item: DecisionItem): DecisionItem {
	return {
		id: item.id,
		...(item.title === undefined ? {} : { title: item.title }),
		point: item.point,
		lifecycle: item.lifecycle,
		...(item.record === undefined ? {} : { record: cloneRecord(item.record) }),
		...(item.proposalMarkdown === undefined ? {} : { proposalMarkdown: item.proposalMarkdown }),
		...(item.exploration === undefined ? {} : { exploration: { ...item.exploration } }),
		...(item.adrId === undefined ? {} : { adrId: item.adrId }),
	};
}

function cloneLedger(ledger: DecisionLedger): DecisionLedger {
	return {
		items: ledger.items.map(cloneItem),
		...(ledger.nextId === undefined ? {} : { nextId: ledger.nextId }),
		...(ledger.usedIds === undefined ? {} : { usedIds: [...ledger.usedIds] }),
	};
}

export function cloneState(state: LedgerState): LedgerState {
	const clonedState: LedgerState = {
		...(state.ledger === undefined ? {} : { ledger: cloneLedger(state.ledger) }),
	};
	if (state.adrs !== undefined) {
		clonedState.adrs = state.adrs.map((adr) => ({ ...adr, sourceDecisionIds: [...adr.sourceDecisionIds] }));
	}
	if (clonedState.ledger !== undefined && state.proposal !== undefined) {
		const proposalItem = clonedState.ledger.items.find(
			(item) => item.id.toUpperCase() === state.proposal!.itemId.toUpperCase(),
		);
		if (proposalItem !== undefined) {
			if (proposalItem.record === undefined) proposalItem.record = cloneRecord(state.proposal.record);
			if (proposalItem.proposalMarkdown === undefined) proposalItem.proposalMarkdown = state.proposal.markdown;
		}
	}
	for (const item of clonedState.ledger?.items ?? []) {
		if ((item.lifecycle as string) !== "exploring") continue;
		const origin = item.exploration?.origin;
		item.lifecycle = origin === "proposed" ? "proposed" : "open";
		if (item.exploration === undefined) item.lifecycle = "open";
	}
	return clonedState;
}

export function emptyLedgerState(): LedgerState {
	return {};
}

function assertRecord(record: unknown): asserts record is DecisionRecord {
	if (!isObject(record)) {
		throw new Error("record is required");
	}
	if (typeof record.decision !== "string" || !record.decision.trim()) {
		throw new Error("record.decision is required");
	}
	if (typeof record.context !== "string" || !record.context.trim()) {
		throw new Error("record.context is required");
	}
	if (typeof record.consequences !== "string" || !record.consequences.trim()) {
		throw new Error("record.consequences is required");
	}
	if (!Array.isArray(record.optionsConsidered) || !record.optionsConsidered.every((value) => typeof value === "string" && value.trim())) {
		throw new Error("record.optionsConsidered must be an array of non-empty strings");
	}
	if (!Array.isArray(record.followUps) || !record.followUps.every((value) => typeof value === "string" && value.trim())) {
		throw new Error("record.followUps must be an array of non-empty strings");
	}
}

function assertLedger(ledger: DecisionLedger | undefined): asserts ledger is DecisionLedger {
	if (ledger === undefined) {
		throw new Error("No decision ledger exists on this branch");
	}
}

function findItem(ledger: DecisionLedger, id: string): DecisionItem {
	const normalized = normalizeDecisionId(id);
	const item = ledger.items.find((candidate) => candidate.id.toUpperCase() === normalized);
	if (!item) {
		throw new Error(`${formatDecisionId(id)} was not found in the current ledger`);
	}
	return item;
}

function ledgerKnownIds(ledger: DecisionLedger): Set<string> {
	const ids = new Set<string>((ledger.usedIds ?? []).map((id) => id.toUpperCase()));
	for (const item of ledger.items) ids.add(item.id.toUpperCase());
	return ids;
}

function randomCharacter(randomBytesSource: RandomBytesSource): string {
	const usableByteCount = 256 - (256 % DECISION_ID_ALPHABET.length);
	for (let attempt = 0; attempt < MAX_RANDOM_BYTE_ATTEMPTS; attempt += 1) {
		const bytes = randomBytesSource(1);
		const byte = bytes[0];
		if (byte === undefined) throw new Error("random ID source returned no bytes");
		if (byte < usableByteCount) return DECISION_ID_ALPHABET[byte % DECISION_ID_ALPHABET.length]!;
	}
	throw new Error("random ID source did not provide a usable byte");
}

export function generateDecisionId(
	reservedIds: ReadonlySet<string>,
	randomBytesSource: RandomBytesSource = (size) => randomBytes(size),
	maxAttempts = MAX_DECISION_ID_ATTEMPTS,
): string {
	const normalizedReservedIds = new Set([...reservedIds].map((id) => id.toUpperCase()));
	const attempts = maxAttempts === undefined || !Number.isFinite(maxAttempts)
		? MAX_DECISION_ID_ATTEMPTS
		: Math.max(1, Math.floor(maxAttempts));
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		let id = "";
		for (let index = 0; index < DECISION_ID_LENGTH; index += 1) {
			id += randomCharacter(randomBytesSource);
		}
		if (!normalizedReservedIds.has(id)) return id;
	}
	throw new Error(`could not allocate a unique decision ID after ${attempts} attempts`);
}

export function getFocusedExploration(state: LedgerState): DecisionItem | undefined {
	return state.ledger?.items.find((item) => item.exploration !== undefined);
}

/**
 * Resolve the proposal belonging to an item. The per-item Markdown is the
 * source of truth for new snapshots; the state-level proposal is accepted only
 * as a legacy fallback for snapshots written before proposals became per-item.
 */
export function getDecisionProposal(state: LedgerState, id: string): DecisionProposal | undefined {
	const normalizedId = normalizeDecisionId(id);
	const item = state.ledger?.items.find((candidate) => candidate.id.toUpperCase() === normalizedId);
	if (item?.record !== undefined && item.proposalMarkdown !== undefined) {
		return {
			itemId: item.id,
			record: cloneRecord(item.record),
			markdown: item.proposalMarkdown,
		};
	}
	if (state.proposal?.itemId.toUpperCase() !== normalizedId) return undefined;
	return {
		itemId: state.proposal.itemId,
		record: cloneRecord(state.proposal.record),
		markdown: state.proposal.markdown,
	};
}

function isUserMessageEntry(entry: LedgerEntryLike): boolean {
	return isObject(entry.message) && entry.message.role === "user";
}

/**
 * Find the destination used by a natural-language exploration tool call.
 * The active leaf is the assistant tool-call entry, so anchor before the
 * triggering user message rather than bookmarking that unresolved entry.
 */
export function findNaturalLanguageExplorationReturnEntryId(
	entries: readonly LedgerEntryLike[],
	leafId?: string,
): string | undefined {
	if (entries.length === 0) return undefined;

	const leafIndex = leafId === undefined ? entries.length - 1 : entries.findIndex((entry) => entry.id === leafId);
	const endIndex = leafIndex < 0 ? entries.length - 1 : leafIndex;
	let userIndex = -1;
	for (let index = endIndex; index >= 0; index -= 1) {
		if (isUserMessageEntry(entries[index])) {
			userIndex = index;
			break;
		}
	}
	if (userIndex < 0) return undefined;

	const precedingEntry = entries[userIndex - 1];
	return precedingEntry !== undefined && typeof precedingEntry.id === "string" ? precedingEntry.id : undefined;
}

export const PROMOTE_REPOSITORY_FLAG = "--repo";
export const PROMOTE_SLUG_FLAG = "--slug";

export function completeDecisionCommandArguments(
	argumentPrefix: string,
	items: readonly (Pick<DecisionItem, "id" | "point"> & { title?: string; adrId?: string })[],
): CompletionItem[] | null {
	const firstSpace = argumentPrefix.indexOf(" ");
	if (firstSpace < 0) {
		const prefix = argumentPrefix.toLowerCase();
		const matches = DECISION_COMMANDS.filter((command) => command.startsWith(prefix));
		if (prefix === "r" || prefix === "re") {
			matches.sort((left, right) => (left === "return" ? -1 : right === "return" ? 1 : left.localeCompare(right)));
		}
		return matches.length === 0
			? null
			: matches.map((command) => ({ value: command, label: command }));
	}

	const command = argumentPrefix.slice(0, firstSpace).toLowerCase();
	const arity = DECISION_ID_COMMANDS[command];
	if (arity === undefined) return null;

	const argumentText = argumentPrefix.slice(firstSpace + 1);
	const tokens = argumentText.split(/\s+/);
	const partialId = argumentText.endsWith(" ") ? "" : (tokens.pop() ?? "");
	if (arity === "single" && tokens.some(Boolean)) return null;
	const selectedTokens = tokens.filter(Boolean);
	// The repository path after --repo is free text, not a decision ID.
	if (command === "promote" && selectedTokens.includes(PROMOTE_REPOSITORY_FLAG)) return null;
	if (command === "promote" && partialId.startsWith("-")) {
		if (selectedTokens.length === 0) return null;
		return [
			...(PROMOTE_SLUG_FLAG.startsWith(partialId) && !selectedTokens.includes(PROMOTE_SLUG_FLAG) ? [{ value: `${command} ${[...selectedTokens, PROMOTE_SLUG_FLAG].join(" ")} `, label: PROMOTE_SLUG_FLAG, description: "stable ADR slug" }] : []),
			...(PROMOTE_REPOSITORY_FLAG.startsWith(partialId) && !selectedTokens.includes(PROMOTE_REPOSITORY_FLAG) ? [{ value: `${command} ${[...selectedTokens, PROMOTE_REPOSITORY_FLAG].join(" ")} `, label: PROMOTE_REPOSITORY_FLAG, description: "explicit Git repository root" }] : []),
		];
	}
	const alreadySelected = new Set(selectedTokens.map((id) => id.toUpperCase()));
	const idPrefix = partialId.toUpperCase();
	const matches = items.filter(
		(item) => !alreadySelected.has(item.id.toUpperCase()) && item.id.toUpperCase().startsWith(idPrefix) &&
			(command === "promote" ? item.adrId === undefined : true),
	);
	return matches.length === 0
		? null
		: matches.map((item) => ({
				value: `${command} ${[...selectedTokens, item.id].join(" ")}`,
				label: formatDecisionIdForTui(item.id),
				description: decisionDisplayTitle(item),
			}));
}

export function completeDecisionsCommandArguments(argumentPrefix: string): CompletionItem[] | null {
	if (argumentPrefix.includes(" ")) return null;
	const prefix = argumentPrefix.toLowerCase();
	const matches = DECISIONS_COMMANDS.filter((command) => command.startsWith(prefix));
	return matches.length === 0
		? null
		: matches.map((command) => ({ value: command, label: command }));
}

interface PreparedAddDecisionItem {
	title: string;
	point: string;
	lifecycle: InitialLifecycle;
	record?: DecisionRecord;
}

function prepareAddDecisionItem(input: AddDecisionItemInput): PreparedAddDecisionItem {
	const point = input.point.trim();
	if (!point) {
		throw new Error("each item needs a non-empty point");
	}
	// The public tool schema requires title. The point fallback keeps direct
	// callers and old integrations source-compatible without rewriting history.
	const title = input.title === undefined ? point : input.title.trim();
	if (!title) {
		throw new Error("each item needs a non-empty concise title");
	}

	const requestedLifecycle: unknown = input.lifecycle === undefined ? "open" : input.lifecycle;
	if (!(INITIAL_LIFECYCLES as readonly unknown[]).includes(requestedLifecycle)) {
		if (requestedLifecycle === "exploring") {
			throw new Error("exploring cannot be used as an initial lifecycle; use /decision explore");
		}
		throw new Error(`invalid initial lifecycle: ${String(requestedLifecycle)}`);
	}
	const lifecycle = requestedLifecycle as InitialLifecycle;
	if (lifecycle === "open" && input.record !== undefined) {
		throw new Error("open items cannot include a decision record when added");
	}
	if ((lifecycle === "proposed" || lifecycle === "resolved" || lifecycle === "ignored") && input.record === undefined) {
		throw new Error(`${lifecycle} items require a complete decision record when added`);
	}
	if (input.record !== undefined) assertRecord(input.record);

	return {
		title,
		point,
		lifecycle,
		...(input.record === undefined ? {} : { record: cloneRecord(input.record) }),
	};
}

export function addDecisionItems(
	state: LedgerState,
	inputs: readonly AddDecisionItemInput[],
	options: AddDecisionItemsOptions = {},
): LedgerState {
	if (inputs.length === 0) {
		throw new Error("at least one item is required");
	}

	// Validate the complete batch before cloning, reserving, or allocating any
	// IDs. A bad item therefore cannot leak a partial item or proposal draft.
	const preparedItems = inputs.map(prepareAddDecisionItem);
	const nextState = cloneState(state);
	const ledger = nextState.ledger ?? { items: [], usedIds: [] };
	const ids = ledgerKnownIds(ledger);
	for (const reservedId of options.reservedIds ?? []) ids.add(reservedId.toUpperCase());
	const randomBytesSource = options.randomBytes ?? ((size: number) => randomBytes(size));
	const newItems: DecisionItem[] = [];

	for (const prepared of preparedItems) {
		const id = generateDecisionId(ids, randomBytesSource, options.maxAttempts);
		ids.add(id);
		const item: DecisionItem = {
			id,
			title: prepared.title,
			point: prepared.point,
			lifecycle: prepared.lifecycle,
			...(prepared.record === undefined ? {} : { record: cloneRecord(prepared.record) }),
		};
		if (prepared.lifecycle === "proposed") {
			item.proposalMarkdown = renderDecisionRecordMarkdown(item, prepared.record!);
		}
		newItems.push(item);
	}

	ledger.items.push(...newItems);
	ledger.usedIds = [...ids];
	nextState.ledger = ledger;
	return nextState;
}

export function applyBatchUpdates(state: LedgerState, updates: readonly DecisionUpdateInput[]): LedgerState {
	if (updates.length === 0) throw new Error("at least one update is required");
	const ledger = state.ledger;
	assertLedger(ledger);
	const normalized = updates.map((update) => ({ ...update, id: normalizeDecisionId(update.id) }));
	const ids = new Set<string>();
	for (const update of normalized) {
		if (ids.has(update.id)) throw new Error(`duplicate update for ${formatDecisionId(update.id)}`);
		ids.add(update.id);
		const item = findItem(ledger, update.id);
		const extra = update as unknown as Record<string, unknown>;
		if ("lifecycle" in extra || "record" in extra) throw new Error(`${formatDecisionId(update.id)} update may change only title and point`);
		if (update.title === undefined && update.point === undefined) throw new Error(`${formatDecisionId(update.id)} has no fields to update`);
		if (update.title !== undefined && !update.title.trim()) throw new Error(`${formatDecisionId(update.id)}.title must not be empty`);
		if (update.point !== undefined && !update.point.trim()) throw new Error(`${formatDecisionId(update.id)}.point must not be empty`);
		void item;
	}
	const nextState = cloneState(state);
	const nextLedger = nextState.ledger;
	assertLedger(nextLedger);
	for (const update of normalized) {
		const item = findItem(nextLedger, update.id);
		if (update.title !== undefined) item.title = update.title.trim();
		if (update.point !== undefined) item.point = update.point.trim();
		if (item.lifecycle === "proposed" && item.record !== undefined) {
			item.proposalMarkdown = renderDecisionRecordMarkdown(item, item.record);
		}
	}
	return nextState;
}

export function removeDecisionItems(state: LedgerState, ids: readonly string[]): LedgerState {
	if (ids.length === 0) throw new Error("at least one decision ID is required");

	const currentLedger = state.ledger;
	assertLedger(currentLedger);
	const normalizedIds = ids.map(normalizeDecisionId);
	const uniqueIds = new Set<string>();
	for (const id of normalizedIds) {
		if (uniqueIds.has(id)) throw new Error(`duplicate removal for ${formatDecisionId(id)}`);
		uniqueIds.add(id);
		const item = findItem(currentLedger, id);
		if (item.exploration !== undefined) {
			throw new Error(`${formatDecisionId(id)} is actively explored and cannot be removed`);
		}
	}

	const nextState = cloneState(state);
	const nextLedger = nextState.ledger;
	assertLedger(nextLedger);
	nextLedger.usedIds = [...ledgerKnownIds(nextLedger)];
	nextLedger.items = nextLedger.items.filter((item) => !uniqueIds.has(item.id.toUpperCase()));
	if (nextState.proposal !== undefined && uniqueIds.has(nextState.proposal.itemId.toUpperCase())) {
		nextState.proposal = undefined;
	}
	return nextState;
}

export type DecisionAction = "explore" | "resolve" | "accept" | "reject" | "ignore" | "reopen" | "defer" | "remove";

export function decisionActionReason(state: LedgerState, id: string, action: DecisionAction): string | undefined {
	try {
		const ledger = state.ledger;
		assertLedger(ledger);
		const item = findItem(ledger, id);
		const displayId = formatDecisionId(item.id);
		const active = item.exploration !== undefined;
		switch (action) {
			case "explore":
				if (active) return `${displayId} is already being explored`;
				if (item.lifecycle === "open" || item.lifecycle === "proposed") return undefined;
				return `${displayId} cannot be explored from ${item.lifecycle}; reopen it first if needed`;
			case "resolve":
				if (active) return `${displayId} is actively explored; use /decision return or /decision exit first`;
				if (item.lifecycle !== "open") return `${displayId} can only be directly resolved from open`;
				return undefined;
			case "accept":
				if (active) return `${displayId} is actively explored; use /decision return or /decision exit first`;
				if (item.lifecycle !== "proposed") return `${displayId} has no lightweight proposal to accept`;
				if (item.record === undefined) return `${displayId} has no complete record to accept`;
				return undefined;
			case "reject":
				if (active) return `${displayId} is actively explored; use /decision return or /decision exit first`;
				return item.lifecycle === "proposed" ? undefined : `${displayId} has no lightweight proposal to reject`;
			case "ignore":
				if (active) return `${displayId} is actively explored; use /decision return or /decision exit first`;
				if (item.lifecycle === "ignored") return `${displayId} is already ignored`;
				if (item.lifecycle === "resolved" || item.lifecycle === "deferred") return `${displayId} is terminal; reopen it before ignoring it`;
				return undefined;
			case "defer":
				if (active) return `${displayId} is actively explored; use /decision return or /decision exit first`;
				if (item.lifecycle === "deferred") return `${displayId} is already deferred`;
				if (item.lifecycle === "resolved" || item.lifecycle === "ignored") return `${displayId} is terminal; reopen it before deferring it`;
				return undefined;
			case "reopen":
				if (active) return `${displayId} is actively explored; use /decision return or /decision exit first`;
				if (item.lifecycle === "resolved" || item.lifecycle === "ignored" || item.lifecycle === "deferred") return undefined;
				return `${displayId} is not terminal and cannot be reopened`;
			case "remove":
				if (active) return `${displayId} is actively explored and cannot be removed`;
				return undefined;
		}
	} catch (error) { return errorMessageForLedger(error); }
}

function errorMessageForLedger(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function applyDecisionAction(
	state: LedgerState,
	id: string,
	action: Exclude<DecisionAction, "explore">,
	record?: DecisionRecord,
): LedgerState {
	const reason = decisionActionReason(state, id, action);
	if (reason !== undefined) throw new Error(reason);
	const normalizedId = normalizeDecisionId(id);
	switch (action) {
		case "resolve":
			if (record === undefined) throw new Error(`${formatDecisionId(id)} requires a complete record to resolve`);
			return resolveDecision(state, normalizedId, record);
		case "accept": return acceptDecisionProposal(state, normalizedId);
		case "reject": return rejectDecisionProposal(state, normalizedId);
		case "ignore": return ignoreDecision(state, normalizedId);
		case "defer": return deferDecision(state, normalizedId);
		case "reopen": return reopenDecision(state, normalizedId);
		case "remove": return removeDecisionItems(state, [normalizedId]);
	}
}

export function exitExploration(state: LedgerState, id?: string): LedgerState {
	const focused = getFocusedExploration(state);
	if (focused === undefined) throw new Error("no active exploration exists");
	if (id !== undefined && normalizeDecisionId(id) !== focused.id.toUpperCase()) {
		throw new Error(`${formatDecisionId(id)} is not the actively explored decision`);
	}

	const nextState = cloneState(state);
	const item = findItem(nextState.ledger!, focused.id);
	item.exploration = undefined;
	return nextState;
}

export function startExploration(
	state: LedgerState,
	id: string,
	returnEntryId: string,
	returnLabel: string,
): LedgerState {
	const currentLedger = state.ledger;
	assertLedger(currentLedger);
	const normalizedId = normalizeDecisionId(id);
	const item = findItem(currentLedger, normalizedId);
	const focused = getFocusedExploration(state);
	if (focused) {
		throw new Error(`${formatDecisionId(focused.id)} is already being explored; return or explicitly switch before starting another exploration`);
	}
	if (!returnEntryId) throw new Error("the current conversation leaf is required for exploration");
	if (!returnLabel) throw new Error("a return label is required for exploration");
	if (item.lifecycle === "resolved") throw new Error(`${formatDecisionId(id)} is already resolved`);
	if (item.lifecycle === "ignored") throw new Error(`${formatDecisionId(id)} is ignored and cannot be explored`);
	if (item.lifecycle === "deferred") throw new Error(`${formatDecisionId(id)} is deferred; reopen it before exploring`);
	if (item.lifecycle !== "open" && !(item.lifecycle === "proposed" && item.exploration === undefined)) {
		throw new Error(`${formatDecisionId(id)} cannot start exploration from ${item.lifecycle}`);
	}

	const nextState = cloneState(state);
	const nextItem = findItem(nextState.ledger!, normalizedId);
	const origin: ExplorationOrigin = nextItem.lifecycle === "proposed" ? "proposed" : "open";
	nextItem.exploration = { returnEntryId, returnLabel, origin };
	return nextState;
}

export function switchExploration(
	state: LedgerState,
	id: string,
	returnEntryId: string,
	returnLabel: string,
): LedgerState {
	const focused = getFocusedExploration(state);
	const normalizedId = normalizeDecisionId(id);
	if (focused !== undefined && focused.id.toUpperCase() !== normalizedId) {
		return startExploration(exitExploration(state, focused.id), normalizedId, returnEntryId, returnLabel);
	}
	return startExploration(state, normalizedId, returnEntryId, returnLabel);
}

export function proposeDecisionRecord(state: LedgerState, id: string, record: DecisionRecord, markdown?: string): LedgerState {
	const currentLedger = state.ledger;
	assertLedger(currentLedger);
	const normalizedId = normalizeDecisionId(id);
	const item = findItem(currentLedger, normalizedId);
	if (item.lifecycle === "ignored") throw new Error(`${formatDecisionId(id)} is ignored and cannot receive a proposal`);
	if (item.lifecycle !== "open" && item.lifecycle !== "proposed") {
		throw new Error(`${formatDecisionId(id)} must be open or proposed before proposing a record`);
	}
	assertRecord(record);
	const nextState = cloneState(state);
	const nextItem = findItem(nextState.ledger!, normalizedId);
	nextItem.lifecycle = "proposed";
	nextItem.record = cloneRecord(record);
	nextItem.proposalMarkdown = markdown ?? renderDecisionRecordMarkdown(nextItem, record);
	return nextState;
}

function updateDisposition(state: LedgerState, id: string, lifecycle: "deferred" | "ignored"): LedgerState {
	const reason = decisionActionReason(state, id, lifecycle === "ignored" ? "ignore" : "defer");
	if (reason !== undefined) throw new Error(reason);
	const nextState = cloneState(state);
	const item = findItem(nextState.ledger!, id);
	item.lifecycle = lifecycle;
	item.proposalMarkdown = undefined;
	item.exploration = undefined;
	return nextState;
}

export function resolveDecision(state: LedgerState, id: string, record: DecisionRecord): LedgerState {
	const reason = decisionActionReason(state, id, "resolve");
	if (reason !== undefined) throw new Error(reason);
	assertRecord(record);
	const nextState = cloneState(state);
	const item = findItem(nextState.ledger!, id);
	item.lifecycle = "resolved";
	item.record = cloneRecord(record);
	item.proposalMarkdown = undefined;
	return nextState;
}

export function acceptDecisionProposal(state: LedgerState, id: string): LedgerState {
	const reason = decisionActionReason(state, id, "accept");
	if (reason !== undefined) throw new Error(reason);
	const nextState = cloneState(state);
	const item = findItem(nextState.ledger!, id);
	item.lifecycle = "resolved";
	item.proposalMarkdown = undefined;
	return nextState;
}

export function rejectDecisionProposal(state: LedgerState, id: string): LedgerState {
	const reason = decisionActionReason(state, id, "reject");
	if (reason !== undefined) throw new Error(reason);
	const nextState = cloneState(state);
	const item = findItem(nextState.ledger!, id);
	item.lifecycle = "open";
	item.record = undefined;
	item.proposalMarkdown = undefined;
	return nextState;
}

export function deferDecision(state: LedgerState, id: string): LedgerState {
	return updateDisposition(state, id, "deferred");
}

export function ignoreDecision(state: LedgerState, id: string): LedgerState {
	return updateDisposition(state, id, "ignored");
}

export function reopenDecision(state: LedgerState, id: string): LedgerState {
	const reason = decisionActionReason(state, id, "reopen");
	if (reason !== undefined) throw new Error(reason);
	const nextState = cloneState(state);
	const item = findItem(nextState.ledger!, id);
	item.lifecycle = "open";
	item.proposalMarkdown = undefined;
	return nextState;
}

export function finalizeExploredProposal(state: LedgerState, id: string, record: DecisionRecord): LedgerState {
	const ledger = state.ledger;
	assertLedger(ledger);
	const normalizedId = normalizeDecisionId(id);
	const item = findItem(ledger, normalizedId);
	if (item.exploration === undefined || item.lifecycle !== "proposed") {
		throw new Error(`${formatDecisionId(id)} must be a proposed actively explored item; use /decision return`);
	}
	if (item.record === undefined || item.proposalMarkdown === undefined) {
		throw new Error(`${formatDecisionId(id)} has no record proposal to finalize`);
	}
	assertRecord(record);
	const nextState = cloneState(state);
	const nextItem = findItem(nextState.ledger!, normalizedId);
	nextItem.lifecycle = "resolved";
	nextItem.record = cloneRecord(record);
	nextItem.proposalMarkdown = undefined;
	nextItem.exploration = undefined;
	return nextState;
}

/** @deprecated Use finalizeExploredProposal for /decision return. */
export const resolveDecisionRecord = finalizeExploredProposal;

export function renderDecisionRecordBody(record: DecisionRecord, headingLevel = 3): string {
	const heading = "#".repeat(Math.max(1, Math.floor(headingLevel)));
	return [
		`${heading} Decision / outcome`,
		record.decision,
		"",
		`${heading} Context`,
		record.context,
		"",
		`${heading} Options considered`,
		...(record.optionsConsidered.length === 0 ? ["- (none)"] : record.optionsConsidered.map((value) => `- ${value}`)),
		"",
		`${heading} Consequences`,
		record.consequences,
		"",
		`${heading} Follow-ups`,
		...(record.followUps.length === 0 ? ["- (none)"] : record.followUps.map((value) => `- ${value}`)),
	].join("\n");
}

export function renderDecisionRecordMarkdown(
	item: Pick<DecisionItem, "id" | "title" | "point">,
	record: DecisionRecord,
): string {
	return [
		`# Decision record — ${formatDecisionId(item.id)}`,
		"",
		`> Title: ${decisionDisplayTitle(item)}`,
		`> Point: ${item.point}`,
		"",
		renderDecisionRecordBody(record),
	].join("\n");
}

function normalizeHeading(heading: string): string {
	return heading.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseList(lines: readonly string[]): string[] {
	const values = lines
		.map((line) => {
			const match = line.match(/^\s*[-*]\s+(.*)$/);
			return (match?.[1] ?? line).trim();
		})
		.filter(Boolean);
	if (values.length === 1 && values[0]?.toLowerCase() === "(none)") return [];
	return values;
}

export interface MarkdownRecordParseResult {
	record?: DecisionRecord;
	errors: string[];
}

export function parseDecisionRecordMarkdown(markdown: string): MarkdownRecordParseResult {
	const sections = new Map<string, string[]>();
	let currentSection: string | undefined;
	for (const line of markdown.split(/\r?\n/)) {
		const heading = line.match(/^###\s+(.+?)\s*$/);
		if (heading) {
			currentSection = normalizeHeading(heading[1]);
			sections.set(currentSection, []);
			continue;
		}
		if (currentSection !== undefined) sections.get(currentSection)!.push(line);
	}

	const errors: string[] = [];
	const textSection = (name: string, label: string): string => {
		const value = sections.get(name)?.join("\n").trim() ?? "";
		if (!value) errors.push(`${label} is required`);
		return value;
	};
	const listSection = (name: string, label: string): string[] => {
		const lines = sections.get(name);
		if (lines === undefined) {
			errors.push(`${label} is required`);
			return [];
		}
		return parseList(lines);
	};

	const record: DecisionRecord = {
		decision: textSection("decisionoutcome", "Decision / outcome"),
		context: textSection("context", "Context"),
		optionsConsidered: listSection("optionsconsidered", "Options considered"),
		consequences: textSection("consequences", "Consequences"),
		followUps: listSection("followups", "Follow-ups"),
	};
	return errors.length === 0 ? { record, errors } : { errors };
}

export function boundLedgerOutput(text: string, maxChars: number): string {
	const limit = Math.max(0, Math.floor(maxChars));
	if (text.length <= limit) return text;
	if (limit === 0) return "";

	const marker = "… output truncated";
	const suffix = `\n${marker}`;
	if (limit <= marker.length) return marker.slice(0, limit);
	return `${text.slice(0, limit - suffix.length).trimEnd()}${suffix}`;
}

export function conciseDecisionPoint(point: string, maxChars = 96): string {
	const limit = Math.max(1, Math.floor(maxChars));
	const normalized = point.replace(/\s+/g, " ").trim();
	if (normalized.length <= limit) return normalized;
	if (limit <= 3) return normalized.slice(0, limit);
	return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

function escapeMarkdownTableCell(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function formatDecisionOverview(state: LedgerState, maxChars = 12000): string {
	if (state.ledger === undefined && (state.adrs?.length ?? 0) === 0) return boundLedgerOutput("No decision ledger on this branch.", maxChars);
	const items = state.ledger?.items ?? [];
	const unresolved = items.filter(isDecisionUnresolved);
	const lines: string[] = [
		`# Decision ledger (${unresolved.length} unresolved / ${items.length} total)`,
		"",
		"| ID | Lifecycle | ADR | Title |",
		"| --- | --- | --- | --- |",
	];
	for (const item of orderDecisionItems(items)) {
		const adr = state.adrs?.find((candidate) => candidate.adrId === item.adrId);
		const durable = adr === undefined ? "—" : `${durableBadge(item, state)} \`${escapeMarkdownTableCell(adr.slug)}\``;
		lines.push(`| ${formatDecisionId(item.id)} | ${item.lifecycle} | ${durable} | ${escapeMarkdownTableCell(decisionDisplayTitle(item))} |`);
	}
	if ((state.adrs?.length ?? 0) > 0) {
		lines.push("", "## ADR registry", "", "| Slug | Lifecycle | File | Sources |", "| --- | --- | --- | --- |");
		for (const adr of state.adrs!) lines.push(`| \`${adr.slug}\` | ${adr.lifecycle} | \`${escapeMarkdownTableCell(adr.relativePath)}\` | ${adr.sourceDecisionIds.map((id) => formatDecisionId(id)).join(", ")} |`);
	}
	const focused = getFocusedExploration(state);
	if (focused?.exploration !== undefined) {
		lines.push("", `Focused exploration: ${formatDecisionId(focused.id)} (return label: \`${focused.exploration.returnLabel}\`)`);
	}
	return boundLedgerOutput(lines.join("\n"), maxChars);
}

/** Unbounded body used by the interactive detail view. */
export function formatDecisionDetailBody(item: Pick<DecisionItem, "title" | "point" | "record">): string {
	const lines = ["### Point", item.point];
	if (item.record !== undefined) {
		lines.push("", renderDecisionRecordBody(item.record));
	} else {
		lines.push("", "No complete decision record is present for this item.");
	}
	return lines.join("\n");
}

export function formatDecisionDetail(state: LedgerState, id: string, maxChars = 12000): string {
	if (state.ledger === undefined) return boundLedgerOutput("No decision ledger on this branch.", maxChars);
	const normalizedId = id.trim().toUpperCase();
	const item = state.ledger.items.find((candidate) => candidate.id.toUpperCase() === normalizedId);
	if (item === undefined) return boundLedgerOutput(`${formatDecisionId(id)} was not found in the current ledger`, maxChars);

	const lines = [
		`# Decision ${formatDecisionId(item.id)}`,
		"",
		`Title: ${decisionDisplayTitle(item)}`,
		`Lifecycle: **${item.lifecycle}**`,
		...(state.adrs?.find((adr) => adr.adrId === item.adrId) === undefined ? [] : durableDetailLines(state.adrs!.find((adr) => adr.adrId === item.adrId)!, "")),
		"",
		formatDecisionDetailBody(item),
	];
	return boundLedgerOutput(lines.join("\n"), maxChars);
}

export function formatReturnReceipt(
	id: string,
	outcome: string,
	_tipLabel?: string,
	maxChars = 1000,
): string {
	return boundLedgerOutput(`Decision ${formatDecisionId(id)} resolved: ${conciseDecisionPoint(outcome, 180)}`, maxChars);
}

/**
 * The overview is intentionally compact. Full records are available through
 * formatDecisionDetail or the tool's detail action.
 */
export function formatLedgerMarkdown(state: LedgerState, maxChars = 12000): string {
	return formatDecisionOverview(state, maxChars);
}

function markdownCodeBlock(value: string): string {
	let fence = "```";
	while (value.includes(fence)) fence += "`";
	return `${fence}text\n${value}\n${fence}`;
}

function markdownExportList(values: readonly string[]): string {
	return markdownCodeBlock(values.length === 0 ? "(none)" : values.map((value) => `- ${value}`).join("\n"));
}

/**
 * Render the complete current-branch ledger without the compact output limit.
 * The ignored-last ordering is presentation-only; state snapshots retain their
 * canonical item order and branch replay is unaffected.
 */
export function formatDecisionExport(state: LedgerState): string {
	const lines = [
		"# Decision ledger export",
		"",
		"Current branch decisions only. Ignored decisions are shown last for readability.",
	];
	if ((state.adrs?.length ?? 0) > 0) {
		lines.push("", "## ADR registry");
		for (const adr of state.adrs!) lines.push("", `### ADR \`${adr.slug}\``, ...durableDetailLines(adr, "- "));
	}
	const ledger = state.ledger;
	if (ledger === undefined) {
		lines.push("", "No decisions are present on this branch.");
		return lines.join("\n");
	}
	if (ledger.items.length === 0) {
		lines.push("", "No decisions are present on this branch.");
		return lines.join("\n");
	}

	for (const item of orderDecisionItems(ledger.items)) {
		lines.push(
			"",
			`## Decision ${formatDecisionId(item.id)}`,
			`- Lifecycle: **${item.lifecycle}**`,
			...(state.adrs?.find((adr) => adr.adrId === item.adrId) === undefined ? [] : durableDetailLines(state.adrs!.find((adr) => adr.adrId === item.adrId)!, "- ")),
			"",
			"### Title",
			markdownCodeBlock(decisionDisplayTitle(item)),
			"",
			"### Point",
			markdownCodeBlock(item.point),
			"",
			"### Complete decision record",
		);
		if (item.record === undefined) {
			lines.push("No complete decision record is present for this item.");
			continue;
		}
		lines.push("", renderDecisionRecordBody(item.record, 4));
	}
	return lines.join("\n");
}

type LegacyDisposition = "chosen" | "accepted" | "ignored" | "follow_up";

function normalizeStoredLifecycle(value: unknown, disposition: unknown): { lifecycle: Lifecycle; legacyExplorationOrigin: ExplorationOrigin } | undefined {
	if (typeof disposition !== "undefined" && !["chosen", "accepted", "ignored", "follow_up"].includes(String(disposition))) return undefined;
	const legacyDisposition = disposition as LegacyDisposition | undefined;
	if (legacyDisposition === "ignored") return { lifecycle: "ignored", legacyExplorationOrigin: "open" };
	if (legacyDisposition === "chosen" || legacyDisposition === "accepted" || legacyDisposition === "follow_up") return { lifecycle: "resolved", legacyExplorationOrigin: "open" };
	if (value === "resolution_proposed") return { lifecycle: "proposed", legacyExplorationOrigin: "proposed" };
	if (value === "exploring") return { lifecycle: "open", legacyExplorationOrigin: "open" };
	if (typeof value !== "string" || !(LIFECYCLES as readonly string[]).includes(value)) return undefined;
	return { lifecycle: value as Lifecycle, legacyExplorationOrigin: value === "proposed" ? "proposed" : "open" };
}

function parseDurablePromotion(value: unknown): DurablePromotion | undefined {
	if (!isObject(value) ||
		typeof value.adrId !== "string" ||
		typeof value.slug !== "string" ||
		typeof value.repositoryRoot !== "string" ||
		typeof value.relativePath !== "string" ||
		typeof value.baseSemanticDigest !== "string" ||
		typeof value.baseSourceFingerprint !== "string" ||
		typeof value.baseSource !== "string" ||
		!Array.isArray(value.sourceDecisionIds) ||
		!value.sourceDecisionIds.every((id) => typeof id === "string")) return undefined;
	if (value.lifecycle !== "draft" && value.lifecycle !== "accepted" && value.lifecycle !== "superseded") return undefined;
	try {
		const adr = importDurableAdr(value.baseSource);
		if (adr.id !== value.adrId || adr.lifecycle !== value.lifecycle || adr.semanticDigest !== value.baseSemanticDigest || adr.sourceFingerprint !== value.baseSourceFingerprint) return undefined;
	} catch { return undefined; }
	return {
		adrId: value.adrId,
		slug: value.slug,
		repositoryRoot: value.repositoryRoot,
		relativePath: value.relativePath,
		lifecycle: value.lifecycle,
		baseSemanticDigest: value.baseSemanticDigest,
		baseSourceFingerprint: value.baseSourceFingerprint,
		baseSource: value.baseSource,
		sourceDecisionIds: [...value.sourceDecisionIds],
	};
}

function parseRecord(value: unknown): DecisionRecord | undefined {
	if (!isObject(value)) return undefined;
	if (
		typeof value.decision !== "string" ||
		typeof value.context !== "string" ||
		typeof value.consequences !== "string" ||
		!Array.isArray(value.optionsConsidered) ||
		!value.optionsConsidered.every((entry) => typeof entry === "string") ||
		!Array.isArray(value.followUps) ||
		!value.followUps.every((entry) => typeof entry === "string")
	) {
		return undefined;
	}
	return {
		decision: value.decision,
		context: value.context,
		optionsConsidered: [...value.optionsConsidered],
		consequences: value.consequences,
		followUps: [...value.followUps],
	};
}

function parseState(value: unknown): LedgerState | undefined {
	if (!isObject(value)) return undefined;
	let ledger: DecisionLedger | undefined;
	const legacyAdrs = new Map<string, DurablePromotion>();
	if (value.ledger !== undefined) {
		const rawLedger = value.ledger;
		if (!isObject(rawLedger) || !Array.isArray(rawLedger.items)) return undefined;
		if (rawLedger.nextId !== undefined && (typeof rawLedger.nextId !== "number" || !Number.isInteger(rawLedger.nextId))) return undefined;
		if (rawLedger.usedIds !== undefined && (!Array.isArray(rawLedger.usedIds) || !rawLedger.usedIds.every((id) => typeof id === "string" && id.length > 0))) {
			return undefined;
		}
		const nextId = rawLedger.nextId;
		const usedIds = rawLedger.usedIds === undefined ? undefined : [...rawLedger.usedIds];
		const items: DecisionItem[] = [];
		for (const rawItem of rawLedger.items) {
			if (!isObject(rawItem) || typeof rawItem.id !== "string" || typeof rawItem.point !== "string") return undefined;
			if (rawItem.title !== undefined && typeof rawItem.title !== "string") return undefined;
			const normalized = normalizeStoredLifecycle(rawItem.lifecycle, rawItem.disposition);
			if (normalized === undefined) return undefined;
			const record = rawItem.record === undefined ? undefined : parseRecord(rawItem.record);
			if (rawItem.record !== undefined && record === undefined) return undefined;
			const durable = rawItem.durable === undefined ? undefined : parseDurablePromotion(rawItem.durable);
			if (rawItem.durable !== undefined && durable === undefined) return undefined;
			const adrId = typeof rawItem.adrId === "string" ? rawItem.adrId : durable?.adrId;
			if (durable !== undefined && value.adrs === undefined) {
				const prior = legacyAdrs.get(durable.adrId);
				if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(durable)) return undefined;
				legacyAdrs.set(durable.adrId, durable);
			}
			const proposalMarkdown = rawItem.proposalMarkdown === undefined
				? undefined
				: typeof rawItem.proposalMarkdown === "string"
					? rawItem.proposalMarkdown
					: undefined;
			if (rawItem.proposalMarkdown !== undefined && proposalMarkdown === undefined) return undefined;
			let exploration: Exploration | undefined;
			if (rawItem.exploration !== undefined) {
				const rawExploration = rawItem.exploration;
				if (isObject(rawExploration) && typeof rawExploration.returnEntryId === "string" && typeof rawExploration.returnLabel === "string") {
					const origin = rawExploration.origin === undefined
						? normalized.legacyExplorationOrigin
						: rawExploration.origin === "open" || rawExploration.origin === "proposed" ? rawExploration.origin : undefined;
					if (origin !== undefined) exploration = { returnEntryId: rawExploration.returnEntryId, returnLabel: rawExploration.returnLabel, origin };
				} else if (rawItem.lifecycle !== "exploring") {
					return undefined;
				}
			}
			items.push({
				id: rawItem.id,
				...(rawItem.title === undefined ? {} : { title: rawItem.title }),
				point: rawItem.point,
				lifecycle: rawItem.lifecycle === "exploring" && exploration?.origin === "proposed" ? "proposed" : normalized.lifecycle,
				...(record === undefined ? {} : { record }),
				...(proposalMarkdown === undefined ? {} : { proposalMarkdown }),
				...(exploration === undefined ? {} : { exploration }),
				...(adrId === undefined ? {} : { adrId }),
			});
		}
		ledger = {
			items,
			...(nextId === undefined ? {} : { nextId }),
			...(usedIds === undefined ? {} : { usedIds }),
		};
	}

	let adrs: DurablePromotion[] | undefined;
	if (value.adrs !== undefined) {
		if (!Array.isArray(value.adrs)) return undefined;
		adrs = [];
		for (const rawAdr of value.adrs) {
			const adr = parseDurablePromotion(rawAdr);
			if (adr === undefined || adrs.some((existing) => existing.adrId === adr.adrId || existing.slug === adr.slug)) return undefined;
			adrs.push(adr);
		}
	} else if (legacyAdrs.size > 0) {
		adrs = [...legacyAdrs.values()];
	}
	if (ledger !== undefined) {
		for (const item of ledger.items) {
			if (item.adrId !== undefined && !adrs?.some((adr) => adr.adrId === item.adrId)) delete item.adrId;
		}
	}

	let proposal: DecisionProposal | undefined;
	if (value.proposal !== undefined) {
		if (!isObject(value.proposal) || typeof value.proposal.itemId !== "string" || typeof value.proposal.markdown !== "string") {
			return undefined;
		}
		const record = parseRecord(value.proposal.record);
		if (record === undefined) return undefined;
		proposal = { itemId: value.proposal.itemId, record, markdown: value.proposal.markdown };
		const proposalItem = ledger?.items.find(
			(item) => item.id.toUpperCase() === proposal!.itemId.toUpperCase(),
		);
		if (proposalItem !== undefined) {
			if (proposalItem.record === undefined) proposalItem.record = cloneRecord(proposal.record);
			if (proposalItem.proposalMarkdown === undefined) proposalItem.proposalMarkdown = proposal.markdown;
		}
	}
	return cloneState({ ...(ledger === undefined ? {} : { ledger }), ...(adrs === undefined ? {} : { adrs }) });
}

export function extractLedgerStateFromEntry(entry: LedgerEntryLike): LedgerState | undefined {
	let candidate: unknown;
	if (entry.type === "custom" && entry.customType === CUSTOM_ENTRY_TYPE) {
		const data = entry.data;
		candidate = isObject(data) && data.extension === CUSTOM_ENTRY_TYPE ? data.state : undefined;
	}
	if (entry.type === "message" && isObject(entry.message)) {
		const message = entry.message;
		if (message.role === "toolResult" && message.toolName === TOOL_NAME && isObject(message.details)) {
			candidate = message.details.state;
		}
	}
	return parseState(candidate);
}

export function collectDecisionIds(entries: readonly LedgerEntryLike[]): Set<string> {
	const ids = new Set<string>();
	for (const entry of entries) {
		const state = extractLedgerStateFromEntry(entry);
		for (const id of state?.ledger?.usedIds ?? []) ids.add(id.toUpperCase());
		for (const item of state?.ledger?.items ?? []) ids.add(item.id.toUpperCase());
	}
	return ids;
}

export function isForkResetEntry(entry: LedgerEntryLike): boolean {
	if (entry.type !== "custom" || entry.customType !== CUSTOM_ENTRY_TYPE || !isObject(entry.data)) return false;
	return entry.data.extension === CUSTOM_ENTRY_TYPE && entry.data.source === "fork_reset";
}

export function replayLedgerBranch(
	entries: readonly LedgerEntryLike[],
	sessionEntries: readonly LedgerEntryLike[] = entries,
): LedgerState {
	let resetIndex = -1;
	for (let index = sessionEntries.length - 1; index >= 0; index -= 1) {
		if (isForkResetEntry(sessionEntries[index])) {
			resetIndex = index;
			break;
		}
	}
	const postResetEntryIds =
		resetIndex < 0
			? undefined
			: new Set(
					sessionEntries
						.slice(resetIndex + 1)
						.map((entry) => entry.id)
						.filter((id): id is string => typeof id === "string"),
				);

	let state = emptyLedgerState();
	for (const entry of entries) {
		if (postResetEntryIds !== undefined && (typeof entry.id !== "string" || !postResetEntryIds.has(entry.id))) continue;
		const next = extractLedgerStateFromEntry(entry);
		if (next !== undefined) state = next;
	}
	return state;
}

export function findNewestOffBranchSnapshot(
	entries: readonly LedgerEntryLike[],
	currentBranchEntryIds: ReadonlySet<string>,
): OffBranchSnapshot | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (typeof entry.id !== "string" || currentBranchEntryIds.has(entry.id)) continue;
		const state = extractLedgerStateFromEntry(entry);
		if (state?.ledger !== undefined) {
			return { entryId: entry.id, timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined, state };
		}
	}
	return undefined;
}
