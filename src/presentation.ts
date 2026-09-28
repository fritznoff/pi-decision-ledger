import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import {
	decisionDisplayTitle,
	decisionProgress,
	decisionStatePresentation,
	formatDecisionIdForTui,
	orderActionableDecisionItems,
	type DecisionItem,
	type LedgerState,
} from "./ledger.ts";

function dimText(text: string): string {
	return `\x1b[2m${text}\x1b[22m`;
}

export function styledDecisionId(id: string, theme: Theme): string {
	return theme.fg("accent", formatDecisionIdForTui(id));
}

export function styledDecisionSymbol(item: Pick<DecisionItem, "lifecycle" | "exploration">, theme: Theme): string {
	const presentation = decisionStatePresentation(item);
	const symbol = presentation.dimmed ? dimText(presentation.symbol) : presentation.symbol;
	if (presentation.ignored) return theme.fg("dim", symbol);
	if (item.exploration !== undefined) return theme.fg("accent", theme.bold(symbol));
	if (presentation.kind === "proposed") return theme.fg("warning", symbol);
	if (presentation.kind === "resolved") return theme.fg("success", symbol);
	return theme.fg(presentation.kind === "deferred" ? "dim" : "muted", symbol);
}

export function styleDecisionPoint(item: Pick<DecisionItem, "title" | "point" | "lifecycle">, theme: Theme): string {
	const title = decisionDisplayTitle(item);
	return item.lifecycle === "ignored" ? theme.fg("dim", theme.strikethrough(title)) : title;
}

/**
 * Width-aware widget for the current session branch. It intentionally keeps
 * the five-row cap and truncates only after the complete styled row exists.
 */
export class DecisionWidget implements Component {
	private readonly state: LedgerState;
	private readonly theme: Theme;

	public constructor(state: LedgerState, theme: Theme) {
		this.state = state;
		this.theme = theme;
	}

	public render(width: number): string[] {
		const availableWidth = Math.max(0, Math.floor(width));
		const progress = decisionProgress(this.state);
		const headingText = `Decisions: ${progress.completed}/${progress.total} completed`;
		const heading = progress.completed === progress.total
			? this.theme.fg("success", headingText)
			: this.theme.fg("accent", headingText);
		const lines = [truncateToWidth(heading, availableWidth, "")];
		const items = this.state.ledger?.items ?? [];
		const actionable = orderActionableDecisionItems(items);
		const focused = items.find((item) => item.exploration !== undefined);
		if (focused !== undefined) {
			lines[0] = truncateToWidth(
				this.theme.fg("accent", `${headingText} • Exploring ${formatDecisionIdForTui(focused.id)}`),
				availableWidth,
				"",
			);
			lines.push(this.renderRow(focused, availableWidth, true));
			return lines;
		}
		for (const item of actionable.slice(0, 5)) {
			lines.push(this.renderRow(item, availableWidth));
		}
		if (actionable.length > 5) {
			lines.push(truncateToWidth(this.theme.fg("dim", `… ${actionable.length - 5} more`), availableWidth, ""));
		}
		return lines;
	}

	private renderRow(item: DecisionItem, width: number, focused = false): string {
		const prefix = `${styledDecisionId(item.id, this.theme)} ${styledDecisionSymbol(item, this.theme)} `;
		const title = decisionDisplayTitle(item);
		const focusLabel = focused ? this.theme.fg("accent", "Exploring ") : "";
		const remainingWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(focusLabel));
		const renderedTitle = truncateToWidth(title, remainingWidth, "…");
		return truncateToWidth(`${prefix}${focusLabel}${renderedTitle}`, width, "");
	}

	public invalidate(): void {
		// The widget is rendered from immutable snapshot data and theme callbacks.
	}
}
