import { StringEnum } from "@earendil-works/pi-ai";
import {
	DynamicBorder,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Loader,
	Markdown,
	SelectList,
	Text,
	matchesKey,
	stripTerminalSequences,
	truncateToWidth,
	type AutocompleteItem,
	type AutocompleteProvider,
	type Component,
	type SelectItem,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	type TUI,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import {
	CUSTOM_ENTRY_TYPE,
	DECISIONS_COMMANDS,
	DECISION_COMMANDS,
	INITIAL_LIFECYCLES,
	DECISION_EXPORT_MESSAGE_TYPE,
	DECISION_OVERVIEW_MESSAGE_TYPE,
	FOCUS_MARKER_MESSAGE_TYPE,
	FOCUS_TRANSITION_MESSAGE_TYPE,
	REVIEW_DRAFT_MESSAGE_TYPE,
	LIFECYCLES,
	RETURN_RECEIPT_MESSAGE_TYPE,
	TOOL_NAME,
	addDecisionItems,
	applyBatchUpdates,
	collectDecisionIds,
	boundLedgerOutput,
	cloneState,
	completeDecisionCommandArguments,
	decisionDisplayTitle,
	formatDecisionDetailBody,
	formatDecisionId,
	formatDecisionIdForTui,
	completeDecisionsCommandArguments,
	decisionExportDelivery,
	decisionOverviewDelivery,
	applyDecisionAction,
	decisionActionReason,
	emptyLedgerState,
	findNaturalLanguageExplorationReturnEntryId,
	findNewestOffBranchSnapshot,
	formatDecisionDetail,
	formatDecisionExport,
	formatDecisionOverview,
	formatReturnReceipt,
	getFocusedExploration,
	getDecisionProposal,
	isDecisionId,
	normalizeDecisionId,
	orderDecisionItems,
	parseDecisionRecordMarkdown,
	proposeDecisionRecord,
	replayLedgerBranch,
	removeDecisionItems,
	resolveDecisionRecord,
	renderDecisionRecordMarkdown,
	startExploration,
	switchExploration,
	exitExploration,
	type AddDecisionItemInput,
	type DecisionItem,
	type DecisionRecord,
	type DecisionAction,
	type DecisionUpdateInput,
	type LedgerCustomEntryData,
	type LedgerSessionDetails,
	type LedgerState,
} from "../src/ledger.ts";
import { DecisionWidget, styledDecisionId, styledDecisionSymbol, styleDecisionPoint } from "../src/presentation.ts";

const DecisionRecordSchema = Type.Object({
	decision: Type.String({ description: "Decision or outcome" }),
	context: Type.String({ description: "Why this decision was needed" }),
	optionsConsidered: Type.Array(Type.String(), { description: "Options considered, possibly empty" }),
	consequences: Type.String({ description: "Important consequences" }),
	followUps: Type.Array(Type.String(), { description: "Follow-up actions, possibly empty" }),
});

const DecisionLedgerParams = Type.Object({
	action: StringEnum(["list", "detail", "add", "update", "explore", "propose", "remove"] as const, {
		description: "Ledger operation",
	}),
	id: Type.Optional(Type.String({ description: "Decision ID" })),
	ids: Type.Optional(Type.Array(Type.String({ description: "Decision ID" }), { description: "One or more decision IDs to remove" })),
	userRequested: Type.Optional(Type.Boolean({ description: "True only when the user explicitly requested removal" })),
	items: Type.Optional(
		Type.Array(
			Type.Object({
				title: Type.String({ description: "A concise decision title, preferably a few meaningful words" }),
				point: Type.String({ description: "The complete, precise user-resolvable decision point" }),
				lifecycle: Type.Optional(StringEnum(INITIAL_LIFECYCLES, {
					description: "Initial lifecycle: open by default; proposed, resolved, deferred, or ignored only when the user supplied or accepted that state",
				})),
				record: Type.Optional(Type.Object({
					decision: Type.String({ description: "Decision or outcome; required for proposed, resolved, and ignored" }),
					context: Type.String({ description: "Why this decision was needed; required for proposed, resolved, and ignored" }),
					optionsConsidered: Type.Array(Type.String(), { description: "Options considered, possibly empty; required for proposed, resolved, and ignored" }),
					consequences: Type.String({ description: "Important consequences; required for proposed, resolved, and ignored" }),
					followUps: Type.Array(Type.String(), { description: "Follow-up actions, possibly empty; required for proposed, resolved, and ignored" }),
				}, { description: "Complete decision record; forbidden for open, optional for deferred" })),
			}),
		),
	),
	updates: Type.Optional(
		Type.Array(
			Type.Object({
				id: Type.String({ description: "Decision ID" }),
				point: Type.Optional(Type.String({ description: "Replacement decision point" })),
				lifecycle: Type.Optional(StringEnum(LIFECYCLES, { description: "New lifecycle" })),
				record: Type.Optional(DecisionRecordSchema),
			}),
		),
	),
	record: Type.Optional(DecisionRecordSchema),
});

type DecisionLedgerParams = Static<typeof DecisionLedgerParams>;
type LedgerAction = DecisionLedgerParams["action"];

const DECISION_USAGE = `Usage: /decision capture | /decision explore <ID> | /decision remove <ID> [<ID> ...] | /decision return | /decision exit`;
const DECISIONS_USAGE = `Usage: /decisions [${DECISIONS_COMMANDS.join(" | ")}]`;
const RETURN_SUMMARY_INSTRUCTIONS = (id: string): string => [
	`The exact reviewed decision record for ${formatDecisionId(id)} is already persisted separately.`,
	"Create a complementary handoff for this focused exploration only.",
	"Do not restate or paraphrase the record's decision, context, options considered, consequences, or follow-ups.",
	"Include only additional concrete evidence or references not captured in the record, unresolved caveats or risks, effects on other decisions or work, and immediate context needed to continue.",
	"If nothing additional exists, say exactly: No additional evidence, caveats, effects, or continuation context beyond the reviewed record.",
	"Keep the handoff focused and bounded. Exclude unrelated work and never claim filesystem changes were reverted.",
].join(" ");

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(ctx.mode === "tui" ? styleDecisionReferences(message, ctx.ui.theme) : message, level);
}

function appendSnapshot(
	pi: ExtensionAPI,
	state: LedgerState,
	source: LedgerCustomEntryData["source"],
): void {
	pi.appendEntry<LedgerCustomEntryData>(CUSTOM_ENTRY_TYPE, {
		extension: CUSTOM_ENTRY_TYPE,
		version: 1,
		source,
		state: cloneState(state),
	});
}

function makeDetails(action: LedgerAction, state: LedgerState, extra: Partial<LedgerSessionDetails> = {}): LedgerSessionDetails {
	return {
		extension: CUSTOM_ENTRY_TYPE,
		version: 1,
		action,
		state: cloneState(state),
		...extra,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function tuiDecisionIds(ids: readonly string[]): string {
	return ids.map(formatDecisionIdForTui).join(", ");
}

function styleDecisionReferences(text: string, theme: Theme): string {
	return text.replace(/`([^`\n]+)`/g, (whole, id: string) =>
		isDecisionId(id) ? theme.fg("accent", formatDecisionIdForTui(id)) : whole,
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => isObject(block) && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function decisionSelectItems(state: LedgerState, theme: Theme): SelectItem[] {
	return orderDecisionItems(state.ledger?.items ?? []).map((item) => ({
		value: item.id,
		label: `${styledDecisionId(item.id, theme)}  ${styledDecisionSymbol(item, theme)} ${item.lifecycle}`,
		description: styleDecisionPoint(item, theme),
	}));
}

function selectorRenderWidth(width: number): number {
	const availableWidth = Math.max(0, Math.floor(width));
	// SelectList reserves two columns in its compact layout. Reclaim that
	// internal safety margin so a narrow row can still show the full [ID].
	// Stop before the dependency switches to its description layout at width 41.
	return availableWidth <= 38 ? availableWidth + 2 : availableWidth;
}

function renderSelector(selectList: SelectList, width: number): string[] {
	const availableWidth = Math.max(0, Math.floor(width));
	return selectList.render(selectorRenderWidth(availableWidth)).map((line) =>
		truncateToWidth(line, availableWidth, ""),
	);
}

function selectorComponent(selectList: SelectList): Component {
	return {
		render: (width: number) => renderSelector(selectList, width),
		invalidate: () => selectList.invalidate(),
		handleMouse: (event: TuiMouseEvent): TuiMouseEventResult | undefined => selectList.handleMouse(event),
	};
}

const RETURN_PROGRESS_WIDGET_KEY = "decision-ledger-return-progress";
const RETURN_PROGRESS_MESSAGE = "Summarizing decision and returning";

class DecisionReturnProgressWidget implements Component {
	private readonly loader: Loader;

	public constructor(tui: TUI, theme: Theme) {
		this.loader = new Loader(
			tui,
			(s: string) => theme.fg("accent", s),
			(s: string) => theme.fg("muted", s),
			RETURN_PROGRESS_MESSAGE,
		);
	}

	public render(width: number): string[] {
		return this.loader.render(width);
	}

	public invalidate(): void {
		this.loader.invalidate();
	}

	public dispose(): void {
		this.loader.stop();
	}
}

type DecisionAutocompleteContext =
	| {
			kind: "subcommand";
			prefix: string;
			replacementStart: number;
			needsSeparator: boolean;
		}
	| {
			kind: "ids";
			command: "explore" | "remove";
			prefix: string;
			replacementStart: number;
			selectedIds: string[];
		}
	| { kind: "blocked" };

interface TokenSpan {
	value: string;
	start: number;
	end: number;
}

function tokenSpans(text: string, offset: number): TokenSpan[] {
	const spans: TokenSpan[] = [];
	const tokenPattern = /[^\s]+/g;
	let match: RegExpExecArray | null;
	while ((match = tokenPattern.exec(text)) !== null) {
		spans.push({ value: match[0], start: offset + match.index, end: offset + match.index + match[0].length });
	}
	return spans;
}

function isDecisionCommandText(textBeforeCursor: string): boolean {
	return textBeforeCursor === "/decision" || /^\/decision[ \t]/.test(textBeforeCursor);
}

function parseDecisionAutocompleteContext(line: string, cursorCol: number): DecisionAutocompleteContext | null {
	const beforeCursor = line.slice(0, Math.max(0, cursorCol));
	if (!isDecisionCommandText(beforeCursor)) return null;
	if (beforeCursor === "/decision") {
		return { kind: "subcommand", prefix: "", replacementStart: cursorCol, needsSeparator: true };
	}

	const afterCommand = beforeCursor.slice("/decision".length);
	const leadingWhitespace = afterCommand.match(/^[ \t]*/)?.[0].length ?? 0;
	const argumentsStart = "/decision".length + leadingWhitespace;
	const argumentText = beforeCursor.slice(argumentsStart);
	const argumentTokens = tokenSpans(argumentText, argumentsStart);
	if (argumentTokens.length === 0) {
		return { kind: "subcommand", prefix: "", replacementStart: cursorCol, needsSeparator: false };
	}

	const firstToken = argumentTokens[0]!;
	const subcommand = firstToken.value.toLowerCase();
	const isKnownSubcommand = DECISION_COMMANDS.includes(subcommand as (typeof DECISION_COMMANDS)[number]);
	if (!isKnownSubcommand) {
		if (argumentTokens.length !== 1) return { kind: "blocked" };
		return { kind: "subcommand", prefix: firstToken.value, replacementStart: firstToken.start, needsSeparator: false };
	}

	const remainder = argumentText.slice(firstToken.value.length);
	if (remainder.length === 0) return { kind: "blocked" };
	if (subcommand !== "explore" && subcommand !== "remove") return { kind: "blocked" };
	if (!/^[ \t]/.test(remainder)) return { kind: "blocked" };

	const idTextStart = firstToken.end;
	const idTokens = tokenSpans(remainder, idTextStart);
	const hasTrailingWhitespace = /[ \t]$/.test(argumentText);
	const partialToken = hasTrailingWhitespace ? undefined : idTokens.at(-1);
	const selectedTokens = partialToken === undefined ? idTokens : idTokens.slice(0, -1);
	if (subcommand === "explore" && selectedTokens.length > 0) return { kind: "blocked" };

	return {
		kind: "ids",
		command: subcommand,
		prefix: partialToken?.value ?? "",
		replacementStart: partialToken?.start ?? cursorCol,
		selectedIds: selectedTokens.map((token) => token.value),
	};
}

function decisionAutocompleteSuggestions(
	context: DecisionAutocompleteContext,
	items: readonly DecisionItem[],
): AutocompleteItem[] | null {
	if (context.kind === "blocked") return null;
	if (context.kind === "subcommand") {
		const prefix = context.prefix.toLowerCase();
		const matches = DECISION_COMMANDS.filter((command) => command.startsWith(prefix));
		if (prefix === "r" || prefix === "re") {
			matches.sort((left, right) => (left === "return" ? -1 : right === "return" ? 1 : left.localeCompare(right)));
		}
		return matches.length === 0 ? null : matches.map((command) => ({ value: command, label: command }));
	}

	const selectedIds = new Set(context.selectedIds.map((id) => id.toUpperCase()));
	const prefix = context.prefix.toUpperCase();
	const matches = items.filter(
		(item) => !selectedIds.has(item.id.toUpperCase()) && item.id.toUpperCase().startsWith(prefix),
	);
	return matches.length === 0
		? null
		: matches.map((item) => ({
				value: item.id,
				label: formatDecisionIdForTui(item.id),
				description: decisionDisplayTitle(item),
			}));
}

function applyDecisionAutocomplete(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: AutocompleteItem,
	context: DecisionAutocompleteContext,
): { lines: string[]; cursorLine: number; cursorCol: number } {
	if (context.kind === "blocked") {
		return { lines, cursorLine, cursorCol };
	}
	const line = lines[cursorLine] ?? "";
	const before = line.slice(0, context.replacementStart);
	const after = line.slice(cursorCol);
	const insertion = context.kind === "subcommand" && context.needsSeparator ? ` ${item.value}` : item.value;
	const nextLines = [...lines];
	nextLines[cursorLine] = `${before}${insertion}${after}`;
	return { lines: nextLines, cursorLine, cursorCol: context.replacementStart + insertion.length };
}

function wrapDecisionAutocomplete(
	current: AutocompleteProvider,
	getItems: () => readonly DecisionItem[],
): AutocompleteProvider {
	return {
		triggerCharacters: current.triggerCharacters,
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const context = parseDecisionAutocompleteContext(lines[cursorLine] ?? "", cursorCol);
			if (context === null) return current.getSuggestions(lines, cursorLine, cursorCol, options);
			const suggestions = decisionAutocompleteSuggestions(context, getItems());
			if (suggestions === null) return null;
			return {
				items: suggestions,
				prefix: context.kind === "blocked" ? "" : context.prefix,
			};
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const context = parseDecisionAutocompleteContext(lines[cursorLine] ?? "", cursorCol);
			if (context === null) return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			return applyDecisionAutocomplete(lines, cursorLine, cursorCol, item, context);
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			const context = parseDecisionAutocompleteContext(lines[cursorLine] ?? "", cursorCol);
			if (context !== null) return false;
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

type FocusTransitionKind = "started" | "switched" | "cleared" | "resolved";

function focusTransitionContent(kind: FocusTransitionKind, item: DecisionItem): string {
	const id = formatDecisionId(item.id);
	const title = decisionDisplayTitle(item);
	switch (kind) {
		case "started":
			return `Decision focus started: ${id} — ${title}. Point: ${item.point}`;
		case "switched":
			return `Decision focus switched to: ${id} — ${title}. Point: ${item.point}`;
		case "cleared":
			return `Decision focus cleared: ${id} — ${title}.`;
		case "resolved":
			return `Decision focus resolved and cleared: ${id} — ${title}.`;
	}
}

function focusMarkerContent(item: DecisionItem): string {
	return [
		`Active decision focus: ${formatDecisionId(item.id)} — ${decisionDisplayTitle(item)}.`,
		`Full point: ${item.point}`,
		"Ambiguous references such as this, it, the decision, and the proposal refer to the active decision unless the current user message explicitly identifies another subject.",
		"A recently resolved decision does not regain focus.",
	].join(" ");
}

function isFocusMarkerMessage(message: unknown): boolean {
	return isObject(message) && message.role === "custom" && message.customType === FOCUS_MARKER_MESSAGE_TYPE;
}

function appendFocusTransition(pi: ExtensionAPI, kind: FocusTransitionKind, item: DecisionItem): void {
	pi.sendMessage(
		{
			customType: FOCUS_TRANSITION_MESSAGE_TYPE,
			content: focusTransitionContent(kind, item),
			display: true,
			details: { kind, itemId: item.id, title: decisionDisplayTitle(item), point: item.point },
		},
		{ triggerTurn: false },
	);
}

async function showDecisionDetails(state: LedgerState, id: string, ctx: ExtensionContext): Promise<"back" | "cancel"> {
	const normalizedId = id.trim().toUpperCase();
	const item = state.ledger?.items.find((candidate) => candidate.id.toUpperCase() === normalizedId);
	const fallback = item === undefined ? formatDecisionDetail(state, id) : undefined;
	return ctx.ui.custom<"back" | "cancel">((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		if (item === undefined) {
			container.addChild(new Text(theme.fg("error", fallback ?? "Decision was not found."), 1, 0));
		} else {
			container.addChild(new Text(
				`${styledDecisionSymbol(item, theme)} ${styledDecisionId(item.id, theme)} ${item.lifecycle}`,
				1,
				0,
			));
			container.addChild(new Text(theme.fg("accent", theme.bold(decisionDisplayTitle(item))), 1, 0));
			container.addChild(new Markdown(formatDecisionDetailBody(item), 1, 1, getMarkdownTheme()));
		}
		container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to return; Ctrl+C to close"), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "ctrl+c")) {
					done("cancel");
					return;
				}
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
					done("back");
					return;
				}
				tui.requestRender();
			},
		};
	});
}

type DecisionSelectorResult =
	| { kind: "details"; id: string }
	| { kind: "action"; id: string; action: DecisionAction }
	| { kind: "help" }
	| null;

type DecisionListActionHandler = (id: string, action: DecisionAction) => Promise<"close" | "stay">;

async function showDecisionList(
	getState: () => LedgerState,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	onAction: DecisionListActionHandler,
): Promise<void> {
	const state = getState();
	if (ctx.mode !== "tui") {
		const overview = formatDecisionOverview(state);
		switch (decisionOverviewDelivery(ctx.mode, ctx.hasUI)) {
			case "notify":
				notify(ctx, overview);
				break;
			case "print":
				console.log(overview);
				break;
			case "message":
				pi.sendMessage({
					customType: DECISION_OVERVIEW_MESSAGE_TYPE,
					content: overview,
					display: true,
				});
				break;
		}
		return;
	}
	if (state.ledger === undefined) {
		notify(ctx, "No decisions on this branch.", "info");
		return;
	}
	if (state.ledger.items.length === 0) {
		notify(ctx, "No decisions on this branch.", "info");
		return;
	}

	while (true) {
		const selected = await ctx.ui.custom<DecisionSelectorResult>((tui, theme, _keybindings, done) => {
			const items = decisionSelectItems(getState(), theme);
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Decision ledger")), 1, 0));
			container.addChild(new Text(theme.fg("dim", "ID  lifecycle  title"), 1, 0));
			const selectList = new SelectList(
				items,
				Math.min(items.length, 10),
				{
					selectedPrefix: (text) => theme.fg("accent", text),
					// SelectList applies selectedText to the complete visible row. Remove
					// semantic ANSI styling first so it cannot override the highlight.
					selectedText: (text) => theme.fg("accent", stripTerminalSequences(text)),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				},
				{
					truncatePrimary: ({ text, isSelected }) =>
						isSelected ? stripTerminalSequences(text) : text,
				},
			);
			selectList.onSelect = (item) => done({ kind: "details", id: item.value });
			selectList.onCancel = () => done(null);
			container.addChild(selectorComponent(selectList));
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • Enter details • e explore • a accept/review • i ignore • r reopen • f defer • Delete remove • ? help • Esc/Ctrl+C close"), 1, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
						done(null);
						return;
					}
					if (matchesKey(data, "delete") || matchesKey(data, "ctrl+d")) {
						const item = selectList.getSelectedItem();
						if (item !== null) done({ kind: "action", id: item.value, action: "remove" });
						return;
					}
					if (data === "?") {
						done({ kind: "help" });
						return;
					}
					const action = data.length === 1 ? data.toLowerCase() : "";
					const actionByKey: Record<string, DecisionAction> = { e: "explore", a: "accept", i: "ignore", r: "reopen", f: "defer" };
					if (actionByKey[action] !== undefined) {
						const item = selectList.getSelectedItem();
						if (item !== null) done({ kind: "action", id: item.value, action: actionByKey[action] });
						return;
					}
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});
		if (selected === null) return;
		if (selected.kind === "help") {
			notify(ctx, "Keys: e explore, a accept/review, i ignore, r reopen, f defer, Delete remove, Enter details, ? help, Esc/Ctrl+C close.", "info");
			continue;
		}
		if (selected.kind === "details") {
			const detailResult = await showDecisionDetails(getState(), selected.id, ctx);
			if (detailResult === "cancel") return;
			continue;
		}
		const result = await onAction(selected.id, selected.action);
		if (result === "close") return;
	}
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
}

function refreshWidget(state: LedgerState, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (state.ledger === undefined) {
		ctx.ui.setWidget("decision-ledger", undefined);
		return;
	}
	ctx.ui.setWidget("decision-ledger", (_tui, theme) => new DecisionWidget(cloneState(state), theme));
}

function stateFingerprint(state: LedgerState): string {
	return JSON.stringify(state);
}

function reconstruct(ctx: ExtensionContext): LedgerState {
	return replayLedgerBranch(ctx.sessionManager.getBranch(), ctx.sessionManager.getEntries());
}

function updateFeedback(state: LedgerState, updates: readonly DecisionUpdateInput[]): string {
	const resolved = updates
		.filter((update) => update.lifecycle === "resolved")
		.map((update) => {
			const id = normalizeDecisionId(update.id);
			const item = state.ledger?.items.find((candidate) => candidate.id.toUpperCase() === id);
			return item === undefined ? undefined : formatReturnReceipt(item.id, item.record?.decision ?? item.point);
		})
		.filter((message): message is string => message !== undefined);
	if (resolved.length > 0) return resolved.join("\n");
	return `Updated ${updates.map((update) => formatDecisionId(normalizeDecisionId(update.id))).join(", ")}.`;
}

function offBranchNotice(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	const candidate = findNewestOffBranchSnapshot(
		ctx.sessionManager.getEntries(),
		new Set(branch.map((entry) => entry.id)),
	);
	if (candidate === undefined) return undefined;
	const focused = getFocusedExploration(candidate.state);
	if (focused !== undefined) {
		return `Exploration ${formatDecisionId(focused.id)} exists on another branch; it was not imported. Use /decisions recover if needed.`;
	}
	return "A decision ledger exists on another branch; it was not imported. Use /decisions recover if needed.";
}

export default function decisionLedgerExtension(pi: ExtensionAPI): void {
	let state: LedgerState = emptyLedgerState();
	let suppressNextTreeNotice = false;
	let returnFollowUpPending = false;
	let returnFollowUpContext: ExtensionContext | undefined;
	let activeContext: ExtensionContext | undefined;
	let returnProgressActive = false;
	let autocompleteInstalled = false;
	let sessionTreeEventCount = 0;

	function installAutocomplete(ctx: ExtensionContext): void {
		if (autocompleteInstalled || ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui.addAutocompleteProvider !== "function") return;
		ctx.ui.addAutocompleteProvider((current) => wrapDecisionAutocomplete(current, () => state.ledger?.items ?? []));
		autocompleteInstalled = true;
	}

	function showReturnProgress(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		activeContext = ctx;
		returnProgressActive = true;
		ctx.ui.setWidget(RETURN_PROGRESS_WIDGET_KEY, (tui, theme) => new DecisionReturnProgressWidget(tui, theme));
	}

	function clearReturnProgress(fallbackContext?: ExtensionContext): void {
		if (!returnProgressActive) return;
		returnProgressActive = false;
		const ctx = activeContext ?? fallbackContext;
		if (ctx?.mode === "tui" && ctx.hasUI) ctx.ui.setWidget(RETURN_PROGRESS_WIDGET_KEY, undefined);
	}

	function clearReturnFollowUp(): void {
		const ctx = returnFollowUpContext;
		returnFollowUpContext = undefined;
		returnFollowUpPending = false;
		if (!ctx?.hasUI) return;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		ctx.ui.setWorkingVisible(true);
	}

	function queueReturnFollowUp(ctx: ExtensionContext, receipt: string): void {
		if (ctx.hasUI) {
			// Keep Pi's own loader and indicator. These calls also reset any stale
			// customization left by an interrupted previous return.
			ctx.ui.setWorkingMessage();
			ctx.ui.setWorkingIndicator();
			ctx.ui.setWorkingVisible(true);
			returnFollowUpContext = ctx;
			returnFollowUpPending = true;
		}

		try {
			pi.sendMessage(
				{
					customType: RETURN_RECEIPT_MESSAGE_TYPE,
					content: receipt,
					display: true,
					details: {},
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} catch (error) {
			clearReturnFollowUp();
			notify(ctx, `Return failed: ${errorMessage(error)}`, "error");
			return;
		}

		if (ctx.isIdle()) {
			clearReturnFollowUp();
			notify(ctx, receipt);
		}
	}

	function appendFocusStateTransition(nextState: LedgerState, kind: FocusTransitionKind, item: DecisionItem): void {
		state = nextState;
		appendSnapshot(pi, state, "command");
		appendFocusTransition(pi, kind, item);
	}

	function restoreProposedState(
		proposedState: LedgerState,
		fallbackContext: ExtensionContext,
		persist: boolean,
	): { context: ExtensionContext; persistenceError?: string } {
		state = cloneState(proposedState);
		let persistenceError: string | undefined;
		if (persist) {
			try {
				// navigateTree changes the active leaf before emitting session_tree. A
				// rollback snapshot must therefore be appended after that event so the
				// destination branch, not just this closure, replays the proposal.
				appendSnapshot(pi, state, "navigation_rollback");
			} catch (error) {
				persistenceError = errorMessage(error);
			}
		}
		const context = activeContext ?? fallbackContext;
		refreshWidget(state, context);
		return persistenceError === undefined ? { context } : { context, persistenceError };
	}

	function hasReviewedDraftOnBranch(ctx: ExtensionContext, id: string, markdown: string): boolean {
		return ctx.sessionManager.getBranch().some((entry) => {
			if (!isObject(entry) || entry.type !== "custom_message" || entry.customType !== REVIEW_DRAFT_MESSAGE_TYPE) return false;
			const details = entry.details;
			return isObject(details) && details.itemId === id && details.markdown === markdown;
		});
	}

	function persistReviewedDraft(ctx: ExtensionContext, id: string, markdown: string, reviewedState: LedgerState): void {
		const current = reconstruct(ctx);
		if (stateFingerprint(current) !== stateFingerprint(reviewedState)) appendSnapshot(pi, reviewedState, "command");
		if (!hasReviewedDraftOnBranch(ctx, id, markdown)) {
			// Custom messages participate in branch context while display=false keeps
			// this replayable handoff out of the transcript. triggerTurn=false avoids
			// an unwanted model turn and appends immediately while the command is idle.
			pi.sendMessage({
				customType: REVIEW_DRAFT_MESSAGE_TYPE,
				content: markdown,
				display: false,
				details: { itemId: id, markdown },
			}, { triggerTurn: false });
		}
	}

	async function reviewAndReturnProposal(ctx: ExtensionCommandContext): Promise<"resolved" | "cancelled"> {
		const focused = getFocusedExploration(state);
		const proposal = focused === undefined ? undefined : getDecisionProposal(state, focused.id);
		if (!focused?.exploration || proposal === undefined) {
			clearReturnProgress(ctx);
			notify(ctx, "Return requires a record proposal for the focused exploration.", "warning");
			return "cancelled";
		}
		if (!ctx.hasUI) {
			clearReturnProgress(ctx);
			notify(ctx, "Return requires interactive Markdown review.", "warning");
			return "cancelled";
		}
		const editedMarkdown = await ctx.ui.editor(`Review decision record ${formatDecisionIdForTui(focused.id)}`, proposal.markdown);
		if (editedMarkdown === undefined) {
			clearReturnProgress(ctx);
			notify(ctx, "Return cancelled.", "info");
			return "cancelled";
		}
		const parsed = parseDecisionRecordMarkdown(editedMarkdown);
		if (!parsed.record) {
			clearReturnProgress(ctx);
			notify(ctx, `Cannot finalize record: ${parsed.errors.join("; ")}`, "error");
			return "cancelled";
		}

		// This is deliberately after editor acceptance and Markdown validation. It
		// must be installed before any reviewed-draft persistence or summarization.
		let proposedState: LedgerState | undefined;
		let treeEventsBeforeNavigation = sessionTreeEventCount;
		try {
			showReturnProgress(ctx);
			const tipEntryId = ctx.sessionManager.getLeafId();
			const tipLabel = `decision-tip-${focused.id}`;
			const returnEntryId = focused.exploration.returnEntryId;
			// Persist the exact reviewed draft before navigation. The item remains
			// proposed, and the context-only custom message makes that draft visible
			// to Pi's branch summarizer without adding duplicate transcript UI.
			proposedState = proposeDecisionRecord(state, focused.id, parsed.record, editedMarkdown);
			state = proposedState;
			persistReviewedDraft(ctx, focused.id, editedMarkdown, proposedState);
			if (!tipEntryId) {
				notify(ctx, "Cannot label the exploration tip.", "error");
				return "cancelled";
			}
			pi.setLabel(tipEntryId, tipLabel);
			treeEventsBeforeNavigation = sessionTreeEventCount;
			suppressNextTreeNotice = true;
			try {
				const navigation = await ctx.navigateTree(returnEntryId, {
					summarize: true,
					customInstructions: RETURN_SUMMARY_INSTRUCTIONS(focused.id),
					replaceInstructions: true,
				});
				if (navigation.cancelled) {
					const restored = restoreProposedState(
						proposedState,
						ctx,
						sessionTreeEventCount > treeEventsBeforeNavigation,
					);
					notify(restored.context, "Return cancelled while navigating to the saved entry.", "warning");
					if (restored.persistenceError !== undefined) {
						notify(restored.context, `Return restoration was not persisted: ${restored.persistenceError}`, "error");
					}
					return "cancelled";
				}
				const finalizedState = resolveDecisionRecord(proposedState, focused.id, parsed.record);
				appendFocusStateTransition(finalizedState, "resolved", focused);
				const receipt = formatReturnReceipt(focused.id, parsed.record.decision, tipLabel);
				const currentContext = activeContext ?? ctx;
				queueReturnFollowUp(currentContext, receipt);
				refreshWidget(state, currentContext);
				return "resolved";
			} catch (error) {
				const restored = restoreProposedState(
					proposedState,
					ctx,
					sessionTreeEventCount > treeEventsBeforeNavigation,
				);
				notify(restored.context, `Return failed: ${errorMessage(error)}`, "error");
				if (restored.persistenceError !== undefined) {
					notify(restored.context, `Return restoration was not persisted: ${restored.persistenceError}`, "error");
				}
				return "cancelled";
			} finally {
				suppressNextTreeNotice = false;
			}
		} catch (error) {
			const restored = proposedState === undefined
				? { context: activeContext ?? ctx }
				: restoreProposedState(proposedState, ctx, sessionTreeEventCount > treeEventsBeforeNavigation);
			notify(restored.context, `Return failed: ${errorMessage(error)}`, "error");
			if ("persistenceError" in restored && restored.persistenceError !== undefined) {
				notify(restored.context, `Return restoration was not persisted: ${restored.persistenceError}`, "error");
			}
			return "cancelled";
		} finally {
			clearReturnProgress(ctx);
			suppressNextTreeNotice = false;
		}
	}

	async function handleSelectorAction(id: string, action: DecisionAction, ctx: ExtensionCommandContext): Promise<"close" | "stay"> {
		const reason = decisionActionReason(state, id, action);
		if (reason !== undefined) {
			notify(ctx, reason, "warning");
			return "stay";
		}

		if (action === "explore") {
			const returnEntryId = ctx.sessionManager.getLeafId();
			if (!returnEntryId) {
				notify(ctx, "Cannot start exploration before the ledger has a conversation entry.", "warning");
				return "stay";
			}
			try {
				const returnLabel = `decision-return-${normalizeDecisionId(id)}`;
				const previousFocus = getFocusedExploration(state);
				const nextState = switchExploration(state, id, returnEntryId, returnLabel);
				if (previousFocus?.exploration !== undefined) pi.setLabel(previousFocus.exploration.returnEntryId, undefined);
				pi.setLabel(returnEntryId, returnLabel);
				const nextFocus = getFocusedExploration(nextState);
				if (nextFocus === undefined) throw new Error("exploration focus was not recorded");
				appendFocusStateTransition(nextState, previousFocus === undefined ? "started" : "switched", nextFocus);
				refreshWidget(state, ctx);
				notify(ctx, `Exploring ${formatDecisionId(normalizeDecisionId(id))}. Return with /decision return after proposing a record.`, "warning");
				return "close";
			} catch (error) {
				notify(ctx, errorMessage(error), "warning");
				return "stay";
			}
		}

		const focusedForAction = getFocusedExploration(state);
		if (action === "accept" && focusedForAction !== undefined && focusedForAction.id.toUpperCase() === normalizeDecisionId(id)) {
			const confirmed = await ctx.ui.confirm("Review proposal?", "Open the Markdown review before resolving this focused exploration?");
			if (!confirmed) {
				notify(ctx, "Acceptance cancelled.", "info");
				return "stay";
			}
			return (await reviewAndReturnProposal(ctx)) === "resolved" ? "close" : "stay";
		}

		if (action === "accept" || action === "ignore" || action === "remove") {
			const label = action === "accept" ? "Accept proposal?" : action === "ignore" ? "Ignore decision?" : "Remove decision?";
			const description = action === "remove"
				? `Remove ${formatDecisionIdForTui(normalizeDecisionId(id))} from the current branch? Earlier snapshots remain unchanged.`
				: `Apply ${action} to ${formatDecisionIdForTui(normalizeDecisionId(id))}?`;
			if (!(await ctx.ui.confirm(label, description))) {
				notify(ctx, `${action[0]!.toUpperCase()}${action.slice(1)} cancelled.`, "info");
				return "stay";
			}
		}

		try {
			state = applyDecisionAction(state, id, action);
			appendSnapshot(pi, state, "command");
			refreshWidget(state, ctx);
			const actionVerb: Record<DecisionAction, string> = { explore: "Explored", accept: "Accepted", ignore: "Ignored", reopen: "Reopened", defer: "Deferred", remove: "Removed" };
			notify(ctx, `${actionVerb[action]} ${formatDecisionId(normalizeDecisionId(id))}.`, "info");
			return "close";
		} catch (error) {
			notify(ctx, errorMessage(error), "warning");
			return "stay";
		}
	}

	pi.registerMessageRenderer(RETURN_RECEIPT_MESSAGE_TYPE, (message, { outputPad }, theme) => {
		return new Text(theme.fg("success", styleDecisionReferences(contentText(message.content), theme)), outputPad, 0);
	});

	pi.registerMessageRenderer(DECISION_EXPORT_MESSAGE_TYPE, (message, { outputPad }) => {
		return new Markdown(contentText(message.content), outputPad, 0, getMarkdownTheme());
	});

	pi.registerMessageRenderer(FOCUS_TRANSITION_MESSAGE_TYPE, (message, { outputPad }, theme) => {
		return new Text(theme.fg("muted", styleDecisionReferences(contentText(message.content), theme)), outputPad, 0);
	});

	pi.on("context", (event, ctx) => {
		// Context is rebuilt from the active branch for every provider call. The
		// closure state can lag during tool loops or after tree navigation.
		state = reconstruct(ctx);
		const focused = getFocusedExploration(state);
		const messages = event.messages.filter((message) => !isFocusMarkerMessage(message));
		if (focused === undefined) {
			return messages.length === event.messages.length ? undefined : { messages };
		}
		return {
			messages: [
				...messages,
				{
					role: "custom" as const,
					customType: FOCUS_MARKER_MESSAGE_TYPE,
					content: focusMarkerContent(focused),
					display: false,
					details: { itemId: focused.id },
					timestamp: Date.now(),
				},
			],
		};
	});

	pi.on("before_agent_start", (event, ctx) => {
		// Keep the system-level reminder aligned with the same live branch used
		// by the per-call context marker.
		state = reconstruct(ctx);
		const focused = getFocusedExploration(state);
		if (focused === undefined) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n[Decision focus: ${formatDecisionId(focused.id)}]\nActive decision: ${focused.point}\nFocus rule: Keep the work centered on this decision. Do not finalize or switch decisions unless the user explicitly asks. Honor explicit requests to switch or exit exploration; do not reject unrelated prompts.`,
		};
	});

	pi.on("agent_settled", () => {
		if (returnFollowUpPending) clearReturnFollowUp();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		// Pi clears its autocomplete wrapper stack while rebinding a session.
		// Allow the next session_start to install exactly one fresh wrapper.
		autocompleteInstalled = false;
		activeContext = ctx;
		clearReturnProgress(ctx);
		if (returnFollowUpPending) clearReturnFollowUp();
		activeContext = undefined;
	});

	pi.on("session_start", (event, ctx) => {
		activeContext = ctx;
		clearReturnProgress(ctx);
		installAutocomplete(ctx);
		if (event.reason === "fork") {
			state = emptyLedgerState();
			appendSnapshot(pi, state, "fork_reset");
		} else {
			state = reconstruct(ctx);
			if (state.ledger === undefined) {
				const notice = offBranchNotice(ctx);
				if (notice !== undefined) notify(ctx, notice, "warning");
			}
		}
		refreshWidget(state, ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		activeContext = ctx;
		sessionTreeEventCount += 1;
		const previous = state;
		const next = reconstruct(ctx);
		const suppressNotice = suppressNextTreeNotice;
		suppressNextTreeNotice = false;

		if (!suppressNotice) {
			const previousFocus = getFocusedExploration(previous);
			const nextFocus = getFocusedExploration(next);
			const notices: string[] = [];
			if (previousFocus && previousFocus.id !== nextFocus?.id) {
				notices.push(`Exploration ${formatDecisionId(previousFocus.id)} was left on another branch; it was not imported.`);
			}
			if (previous.ledger !== undefined && stateFingerprint(previous) !== stateFingerprint(next)) {
				notices.push("The selected branch has a different decision ledger; state was not imported.");
			}
			if (next.ledger === undefined && notices.length === 0) {
				const notice = offBranchNotice(ctx);
				if (notice !== undefined) notices.push(notice);
			}
			if (notices.length > 0) notify(ctx, notices.join(" "), "warning");
		}

		state = next;
		refreshWidget(state, ctx);
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Decision Ledger",
		description:
			"Manage the current session and conversation-branch decision ledger. Use list for a compact overview, detail for one full record, add to atomically add titled points (optionally with a user-supplied initial lifecycle and complete record), update to atomically apply changes, explore to start focused investigation, propose to save a lightweight or explored record draft, and remove to atomically remove requested items. Add defaults to open; exploring is not valid on add. Tool output is bounded; state is branch-aware.",
		promptSnippet: "Track user-resolvable decisions and compact decision records for this Pi session branch",
		promptGuidelines: [
			"Use decision_ledger action add once with all user-resolvable points before presenting two or more such points to the user.",
			"For every decision_ledger add item, provide a minimal meaningful title, preferably a few words, and keep the complete precise decision point in point.",
			"On add, omit lifecycle to default to open and never silently resolve a decision. Set proposed, resolved, deferred, or ignored only when the user already supplied or explicitly accepted that initial state; include a complete record for proposed, resolved, and ignored, and optionally for deferred. Never use exploring as an add lifecycle.",
			"Use decision_ledger action update with one batch for resolutions that belong together; do not silently decide a point for the user.",
			"Use decision_ledger action explore only when the user explicitly and unambiguously asks to explore a specific decision; ask for clarification when the target is ambiguous.",
			"Use decision_ledger action propose on an open item for a lightweight proposal, or on the focused item after exploration; lightweight proposals resolve or return to open with update, while explored proposals finalize through /decision return.",
			"Use decision_ledger action remove only when the user explicitly requested removal, and set userRequested to true only for that request. Never remove the actively explored decision.",
		],
		parameters: DecisionLedgerParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				switch (params.action) {
					case "list":
						refreshWidget(state, ctx);
						return {
							content: [{ type: "text", text: formatDecisionOverview(state) }],
							details: makeDetails(params.action, state),
						};

					case "detail": {
						if (params.id === undefined) throw new Error("id is required for detail");
						return {
							content: [{ type: "text", text: formatDecisionDetail(state, params.id) }],
							details: makeDetails(params.action, state),
						};
					}

					case "explore": {
						if (params.id === undefined) throw new Error("id is required for explore");
						const id = normalizeDecisionId(params.id);
						const returnEntryId = findNaturalLanguageExplorationReturnEntryId(
							ctx.sessionManager.getBranch(),
							ctx.sessionManager.getLeafId() ?? undefined,
						);
						if (returnEntryId === undefined) {
							throw new Error("Cannot start exploration because no conversation entry precedes the triggering user message");
						}
						const returnLabel = `decision-return-${id}`;
						const previousFocus = getFocusedExploration(state);
						const next = switchExploration(state, id, returnEntryId, returnLabel);
						if (previousFocus?.exploration !== undefined) pi.setLabel(previousFocus.exploration.returnEntryId, undefined);
						pi.setLabel(returnEntryId, returnLabel);
						const nextFocus = getFocusedExploration(next);
						if (nextFocus === undefined) throw new Error("exploration focus was not recorded");
						appendFocusStateTransition(next, previousFocus === undefined ? "started" : "switched", nextFocus);
						refreshWidget(state, ctx);
						return {
							content: [{
								type: "text",
								text: `Exploring ${formatDecisionId(id)}. Return label: ${returnLabel}. /tree changes conversation state only; filesystem changes are not reverted.`,
							}],
							details: makeDetails(params.action, state, { returnEntryId, returnLabel }),
						};
					}

					case "remove": {
						if (params.userRequested !== true) {
							throw new Error("remove requires an explicit user request; set userRequested to true only when the user asked for removal");
						}
						if (params.ids === undefined) throw new Error("ids are required for remove");
						const ids = params.ids.map((id) => normalizeDecisionId(id));
						const next = removeDecisionItems(state, ids);
						state = next;
						refreshWidget(state, ctx);
						return {
							content: [{ type: "text", text: `Removed ${ids.map((id) => formatDecisionId(id)).join(", ")}.` }],
							details: makeDetails(params.action, state, { updatedIds: ids }),
						};
					}

					case "add": {
						if (params.items === undefined) throw new Error("items are required for add");
						const next = addDecisionItems(state, params.items as AddDecisionItemInput[], {
							reservedIds: collectDecisionIds(ctx.sessionManager.getEntries()),
						});
						const beforeIds = new Set(state.ledger?.items.map((item) => item.id) ?? []);
						const addedItems = next.ledger?.items.filter((item) => !beforeIds.has(item.id)) ?? [];
						const addedIds = addedItems.map((item) => item.id);
						state = next;
						refreshWidget(state, ctx);
						return {
							content: [{
								type: "text",
								text: `Added ${addedItems.map((item) => `${formatDecisionId(item.id)} (${item.lifecycle})`).join(", ")}.`,
							}],
							details: makeDetails(params.action, state, { addedIds }),
						};
					}

					case "update": {
						if (params.updates === undefined) throw new Error("updates are required for update");
						const next = applyBatchUpdates(state, params.updates as DecisionUpdateInput[]);
						state = next;
						refreshWidget(state, ctx);
						return {
							content: [{ type: "text", text: updateFeedback(state, params.updates as DecisionUpdateInput[]) }],
							details: makeDetails(params.action, state, {
								updatedIds: params.updates.map((update) => normalizeDecisionId(update.id)),
							}),
						};
					}

					case "propose": {
						if (params.id === undefined) throw new Error("id is required for propose");
						if (params.record === undefined) throw new Error("record is required for propose");
						const id = normalizeDecisionId(params.id);
						const item = state.ledger?.items.find((candidate) => candidate.id.toUpperCase() === id);
						if (item === undefined) throw new Error(`${formatDecisionId(params.id)} was not found in the current ledger`);
						const markdown = renderDecisionRecordMarkdown(item, params.record as DecisionRecord);
						const next = proposeDecisionRecord(state, id, params.record as DecisionRecord, markdown);
						state = next;
						refreshWidget(state, ctx);
						return {
							content: [{ type: "text", text: boundLedgerOutput(markdown, 12000) }],
							details: makeDetails(params.action, state),
						};
					}
				}
			} catch (error) {
				const message = errorMessage(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: makeDetails(params.action, state, { error: message }),
				};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("decision_ledger ")) + theme.fg("muted", args.action);
			if (args.id) text += ` ${styledDecisionId(args.id, theme)}`;
			if (args.ids) text += ` ${theme.fg("accent", args.ids.map((id: string) => formatDecisionIdForTui(id)).join(", "))}`;
			if (args.items) text += ` ${theme.fg("dim", `(${args.items.length} item${args.items.length === 1 ? "" : "s"})`)}`;
			if (args.updates) text += ` ${theme.fg("dim", `(${args.updates.length} update${args.updates.length === 1 ? "" : "s"})`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as LedgerSessionDetails | undefined;
			if (!details) return new Text(resultText(result), 0, 0);
			if (details.error) return new Text(theme.fg("error", styleDecisionReferences(`Error: ${details.error}`, theme)), 0, 0);
			if (details.action === "list") return new Text(styleDecisionReferences(formatDecisionOverview(details.state), theme), 0, 0);
			if (details.action === "detail") return new Text(styleDecisionReferences(resultText(result), theme), 0, 0);
			if (details.action === "propose" && expanded && details.state.proposal) {
				return new Text(styleDecisionReferences(details.state.proposal.markdown, theme), 0, 0);
			}
			return new Text(theme.fg("success", styleDecisionReferences(resultText(result), theme)), 0, 0);
		},
	});

	pi.registerCommand("decisions", {
		description: "Show, export, or recover the current-branch decision ledger",
		getArgumentCompletions: (prefix) => completeDecisionsCommandArguments(prefix),
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase();
			if (!command) {
				await showDecisionList(() => state, ctx, pi, (id, action) => handleSelectorAction(id, action, ctx));
				return;
			}
			if (command === "export") {
				const markdown = formatDecisionExport(state);
				if (decisionExportDelivery(ctx.mode) === "print") {
					console.log(markdown);
				} else {
					pi.sendMessage(
						{
							customType: DECISION_EXPORT_MESSAGE_TYPE,
							content: markdown,
							display: true,
						},
						{ triggerTurn: false },
					);
				}
				return;
			}
			if (command !== "recover") {
				notify(ctx, DECISIONS_USAGE, "warning");
				return;
			}

			if (state.ledger !== undefined) {
				notify(ctx, "Cannot recover into a branch that already has a decision ledger.", "warning");
				return;
			}
			const branch = ctx.sessionManager.getBranch();
			const candidate = findNewestOffBranchSnapshot(
				ctx.sessionManager.getEntries(),
				new Set(branch.map((entry) => entry.id)),
			);
			if (candidate === undefined) {
				notify(ctx, "No off-branch decision ledger snapshot was found.", "info");
				return;
			}
			if (!ctx.hasUI) {
				notify(ctx, "Recovery requires explicit interactive confirmation.", "warning");
				return;
			}
			const confirmed = await ctx.ui.confirm(
				"Recover decision ledger?",
				`Copy the whole snapshot from ${candidate.state.ledger?.items.length ?? 0} item(s) on another branch?`,
			);
			if (!confirmed) {
				notify(ctx, "Recovery cancelled.", "info");
				return;
			}
			state = cloneState(candidate.state);
			appendSnapshot(pi, state, "recovery");
			refreshWidget(state, ctx);
			notify(ctx, `Recovered the decision ledger from off-branch snapshot ${candidate.entryId}.`);
		},
	});

	pi.registerCommand("decision", {
		description: `Capture, explore, remove, return, or exit decision exploration (${DECISION_COMMANDS.join(" | ")})`,
		getArgumentCompletions: (prefix) =>
			completeDecisionCommandArguments(prefix, state.ledger?.items ?? []),
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = parts[0];

			if (subcommand === "capture" && parts.length === 1) {
				const request = [
					"Review your immediately preceding assistant reply in this conversation.",
					"Identify only points where the user must choose, confirm, or provide a preference.",
					"If any exist, call decision_ledger action add exactly once with all titled points so the batch is atomic; give each a minimal meaningful title of a few words, keep the full precise wording in point, then present the points with their IDs and ask the user to resolve them.",
					"Do not decide any point for the user. If none exist, say that no user-resolvable decision points were found.",
				].join(" ");
				if (ctx.isIdle()) pi.sendUserMessage(request);
				else pi.sendUserMessage(request, { deliverAs: "followUp" });
				notify(ctx, "Capture request queued for the main agent.");
				return;
			}

			if (subcommand === "explore" && parts.length === 2) {
				let id: string;
				try {
					id = normalizeDecisionId(parts[1]);
				} catch (error) {
					notify(ctx, DECISION_USAGE, "warning");
					return;
				}
				const returnEntryId = ctx.sessionManager.getLeafId();
				if (!returnEntryId) {
					notify(ctx, "Cannot start exploration before the ledger has a conversation entry.", "warning");
					return;
				}
				try {
					const returnLabel = `decision-return-${id}`;
					const previousFocus = getFocusedExploration(state);
					const nextState = switchExploration(state, id, returnEntryId, returnLabel);
					if (previousFocus?.exploration !== undefined) pi.setLabel(previousFocus.exploration.returnEntryId, undefined);
					pi.setLabel(returnEntryId, returnLabel);
					const nextFocus = getFocusedExploration(nextState);
					if (nextFocus === undefined) throw new Error("exploration focus was not recorded");
					appendFocusStateTransition(nextState, previousFocus === undefined ? "started" : "switched", nextFocus);
					refreshWidget(state, ctx);
					notify(
						ctx,
						`Exploring ${formatDecisionId(id)}. Return with /decision return after proposing a record. /tree changes conversation state only; filesystem changes are not reverted.`,
						"warning",
					);
				} catch (error) {
					notify(ctx, errorMessage(error), "warning");
				}
				return;
			}

			if (subcommand === "exit" && parts.length === 1) {
				const focused = getFocusedExploration(state);
				if (focused === undefined) {
					notify(ctx, "No active exploration exists.", "info");
					return;
				}
				try {
					const nextState = exitExploration(state, focused.id);
					if (focused.exploration !== undefined) pi.setLabel(focused.exploration.returnEntryId, undefined);
					appendFocusStateTransition(nextState, "cleared", focused);
					refreshWidget(state, ctx);
					notify(ctx, `Exploration ${formatDecisionId(focused.id)} exited.`, "info");
				} catch (error) {
					notify(ctx, errorMessage(error), "warning");
				}
				return;
			}

			if (subcommand === "remove" && parts.length >= 2) {
				if (!ctx.hasUI) {
					notify(ctx, "Removal requires explicit interactive confirmation.", "warning");
					return;
				}
				let ids: string[];
				try {
					ids = parts.slice(1).map(normalizeDecisionId);
				} catch (error) {
					notify(ctx, errorMessage(error), "warning");
					return;
				}
				try {
					// Validate before asking so an active exploration is refused without
					// presenting a destructive confirmation for an impossible action.
					removeDecisionItems(state, ids);
				} catch (error) {
					notify(ctx, errorMessage(error), "warning");
					return;
				}
				const confirmed = await ctx.ui.confirm(
					"Remove decisions?",
					`Remove ${tuiDecisionIds(ids)} from the current branch? Earlier snapshots will remain unchanged.`,
				);
				if (!confirmed) {
					notify(ctx, "Removal cancelled.", "info");
					return;
				}
				try {
					state = removeDecisionItems(state, ids);
					appendSnapshot(pi, state, "command");
					refreshWidget(state, ctx);
					notify(ctx, `Removed ${ids.map((id) => formatDecisionId(id)).join(", ")}.`, "info");
				} catch (error) {
					notify(ctx, errorMessage(error), "warning");
				}
				return;
			}

			if (subcommand === "return" && parts.length === 1) {
				await reviewAndReturnProposal(ctx);
				return;
			}

			notify(ctx, DECISION_USAGE, "warning");
		},
	});
}
