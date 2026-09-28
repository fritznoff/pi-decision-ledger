import {
	type DurableAdr,
	type DurableAdrFields,
	createDurableAdrFromBody,
	durableAdrBody,
	renderDurableAdrBody,
	updateDurableAdr,
	validateDurableAdrBody,
} from "./durable.ts";
import {
	type DurableCheckout,
	type DurableConflict,
	type DurablePublishResult,
	type RepositoryProvenance,
	acceptDurableAdr,
	checkoutDurableAdr,
	createDurableAdrFile,
	deleteDurableDraft,
	publishDurableBody,
} from "./durable-repository.ts";
import {
	type DecisionItem,
	type DecisionRecord,
	type DurablePromotion,
	type LedgerState,
	cloneState,
	decisionDisplayTitle,
	formatDecisionId,
	normalizeDecisionId,
} from "./ledger.ts";

/** Promotion is explicit and selective; terminal dispositions are not promoted. */
export const PROMOTABLE_LIFECYCLES = ["open", "proposed", "resolved"] as const;

export const DEFAULT_ADR_DIRECTORY = "decisions";

/** One session decision, frozen as it stood when promotion was requested. */
export interface PromotionSource {
	readonly id: string;
	readonly title: string;
	readonly point: string;
	readonly record?: Readonly<Omit<DecisionRecord, "optionsConsidered" | "followUps">> & {
		readonly optionsConsidered: readonly string[];
		readonly followUps: readonly string[];
	};
}

/**
 * Resolve an explicit source set. The caller's order is preserved verbatim; no
 * semantic grouping is inferred and no item is added or dropped.
 */
export function collectPromotionSources(state: LedgerState, ids: readonly string[]): readonly PromotionSource[] {
	const items = state.ledger?.items;
	if (items === undefined) throw new Error("there is no decision ledger on this branch");
	if (ids.length === 0) throw new Error("promotion requires at least one decision ID");
	const normalized = ids.map(normalizeDecisionId);
	const seen = new Set<string>();
	for (const id of normalized) {
		if (seen.has(id)) throw new Error(`duplicate decision ID: ${formatDecisionId(id)}`);
		seen.add(id);
	}
	return Object.freeze(normalized.map((id) => {
		const item = items.find((candidate) => candidate.id.toUpperCase() === id);
		if (item === undefined) throw new Error(`unknown decision: ${formatDecisionId(id)}`);
		const registered = state.adrs?.find((adr) => adr.adrId === item.adrId);
		if (registered !== undefined) throw new Error(`${formatDecisionId(id)} is already promoted to ${registered.relativePath}`);
		if (item.exploration !== undefined) throw new Error(`${formatDecisionId(id)} is actively explored; use /decision return or /decision exit first`);
		if (!(PROMOTABLE_LIFECYCLES as readonly string[]).includes(item.lifecycle)) {
			throw new Error(`${formatDecisionId(id)} is ${item.lifecycle}; only ${PROMOTABLE_LIFECYCLES.join(", ")} decisions can be promoted`);
		}
		return freezeSource(item);
	}));
}

function freezeSource(item: DecisionItem): PromotionSource {
	const record = item.record === undefined
		? undefined
		: Object.freeze({
			decision: item.record.decision,
			context: item.record.context,
			optionsConsidered: Object.freeze([...item.record.optionsConsidered]),
			consequences: item.record.consequences,
			followUps: Object.freeze([...item.record.followUps]),
		});
	return Object.freeze({
		id: item.id,
		title: decisionDisplayTitle(item),
		point: item.point,
		...(record === undefined ? {} : { record }),
	});
}

/**
 * Deterministic one-to-one mapping of a single source. Several sources need
 * judgment about grouping and wording, which belongs to the skill and is
 * supplied directly by the agent during promotion.
 */
export function promotionFields(sources: readonly PromotionSource[]): DurableAdrFields {
	if (sources.length === 0) throw new Error("promotion requires at least one source decision");
	if (sources.length > 1) throw new Error("several sources need an agent-synthesized candidate; there is no mechanical consolidation");
	const single = sources[0]!;
	const context = [single.point, single.record?.context].filter((value): value is string => value !== undefined && value !== "").join("\n\n");
	return {
		title: single.title,
		context,
		optionsConsidered: [...(single.record?.optionsConsidered ?? [])],
		decision: single.record?.decision ?? "",
		consequences: single.record?.consequences ?? "",
		supersedes: [],
	};
}

/** The deterministic single-source ADR Markdown offered for review. */
export function renderPromotionBody(sources: readonly PromotionSource[]): string {
	return renderDurableAdrBody(promotionFields(sources));
}

/**
 * Generate the one-source Markdown used by direct slash-command promotion.
 * Multi-source synthesis requires agent judgment and therefore uses the
 * model-callable promote_adr action with explicit Markdown.
 */
export function promotionReviewBody(state: LedgerState, ids: readonly string[]): { body: string } {
	const sources = collectPromotionSources(state, ids);
	if (sources.length > 1) throw new Error("multi-source promotion requires the agent to synthesize one coherent ADR and call decision_ledger action promote_adr with the exact Markdown");
	return { body: renderPromotionBody(sources) };
}

export interface PromoteArguments {
	ids: string[];
	slug?: string;
	repository?: string;
}

export function normalizeAdrSlug(value: string): string {
	const slug = value.trim().toLowerCase();
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new Error("ADR slug must be 1-80 lowercase letters, numbers, and single hyphens");
	return slug;
}

export function slugFromTitle(title: string): string {
	const value = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
	return normalizeAdrSlug(value === "" ? "adr" : value);
}

/** `<ID> [<ID> ...] [--slug <slug>] [--repo <path>]`; repository path is the verbatim remainder. */
export function parsePromoteArguments(args: string): PromoteArguments {
	const repoMatch = /(?:^|\s)--repo(?:\s+|$)/.exec(args);
	const beforeRepo = repoMatch === null ? args : args.slice(0, repoMatch.index);
	const repository = repoMatch === null ? undefined : args.slice(repoMatch.index + repoMatch[0].length).trim();
	if (repository === "") throw new Error("--repo requires a repository path");
	const slugMatch = /(?:^|\s)--slug\s+(\S+)(?:\s|$)/.exec(beforeRepo);
	const slug = slugMatch === null ? undefined : normalizeAdrSlug(slugMatch[1]!);
	const idText = slugMatch === null ? beforeRepo : `${beforeRepo.slice(0, slugMatch.index)} ${beforeRepo.slice(slugMatch.index + slugMatch[0].length)}`;
	const ids = idText.trim().split(/\s+/).filter(Boolean).map(normalizeDecisionId);
	return { ids, ...(slug === undefined ? {} : { slug }), ...(repository === undefined ? {} : { repository }) };
}

/** Stable human-readable repository path; the UUID remains inside the ADR. */
export function promotionRelativePath(slug: string, directory = DEFAULT_ADR_DIRECTORY): string {
	return `${directory}/${normalizeAdrSlug(slug)}.md`;
}

function promotionFrom(checkout: DurableCheckout, sourceIds: readonly string[], slug: string): DurablePromotion {
	return {
		adrId: checkout.id,
		slug,
		repositoryRoot: checkout.provenance.repositoryRoot,
		relativePath: checkout.provenance.relativePath,
		lifecycle: checkout.lifecycle,
		baseSemanticDigest: checkout.baseSemanticDigest,
		baseSourceFingerprint: checkout.baseSourceFingerprint,
		baseSource: checkout.baseSource,
		sourceDecisionIds: [...sourceIds],
	};
}

/** Attach the working-copy provenance to every source decision of this ADR. */
export function attachDurablePromotion(state: LedgerState, promotion: DurablePromotion): LedgerState {
	const nextState = cloneState(state);
	const items = nextState.ledger?.items;
	if (items === undefined) throw new Error("there is no decision ledger on this branch");
	if ((nextState.adrs ?? []).some((adr) => adr.adrId === promotion.adrId || adr.slug === promotion.slug)) throw new Error(`ADR slug or identity already registered: ${promotion.slug}`);
	nextState.adrs = [...(nextState.adrs ?? []), { ...promotion, sourceDecisionIds: [...promotion.sourceDecisionIds] }];
	for (const id of promotion.sourceDecisionIds) {
		const item = items.find((candidate) => candidate.id.toUpperCase() === id.toUpperCase());
		if (item === undefined) throw new Error(`unknown decision: ${formatDecisionId(id)}`);
		item.adrId = promotion.adrId;
	}
	return nextState;
}

export function findDurablePromotion(state: LedgerState, id: string): DurablePromotion | undefined {
	const normalized = normalizeDecisionId(id);
	const adrId = state.ledger?.items.find((item) => item.id.toUpperCase() === normalized)?.adrId;
	return state.adrs?.find((adr) => adr.adrId === adrId);
}

export function findRegisteredAdr(state: LedgerState, reference: string): DurablePromotion | undefined {
	const normalized = reference.trim().toLowerCase();
	return state.adrs?.find((adr) => adr.slug === normalized || adr.adrId === normalized);
}

/** Re-sync the registry and attached source working copies after a file change. */
export function syncDurablePromotion(state: LedgerState, checkout: DurableCheckout): LedgerState {
	const nextState = cloneState(state);
	for (const adr of nextState.adrs ?? []) {
		if (adr.adrId !== checkout.id) continue;
		adr.lifecycle = checkout.lifecycle;
		adr.baseSemanticDigest = checkout.baseSemanticDigest;
		adr.baseSourceFingerprint = checkout.baseSourceFingerprint;
		adr.baseSource = checkout.baseSource;
	}
	return nextState;
}

export interface PromotionRequest {
	repositoryRoot: string;
	/** The reviewed ADR Markdown. Nothing else contributes to the written file. */
	reviewedBody: string;
	sourceIds: readonly string[];
	directory?: string;
	adrId?: string;
	slug?: string;
}

export interface PromotionOutcome {
	state: LedgerState;
	promotion: DurablePromotion;
	absolutePath: string;
	adr: DurableAdr;
}

/**
 * Validate the reviewed text, write the draft, then attach provenance. Any
 * failure before the file exists leaves no identity and no state change; a
 * failure to write leaves the ledger untouched as well.
 */
export async function promoteReviewedBody(state: LedgerState, request: PromotionRequest): Promise<PromotionOutcome> {
	const sources = collectPromotionSources(state, request.sourceIds);
	const adr = createDurableAdrFromBody(request.reviewedBody, request.adrId === undefined ? {} : { id: request.adrId });
	const slug = request.slug === undefined ? slugFromTitle(adr.title) : normalizeAdrSlug(request.slug);
	if ((state.adrs ?? []).some((existing) => existing.slug === slug)) throw new Error(`ADR slug already registered: ${slug}`);
	if ((state.adrs ?? []).some((existing) => existing.adrId === adr.id)) throw new Error(`ADR identity already registered: ${adr.id}`);
	const provenance: RepositoryProvenance = {
		repositoryRoot: request.repositoryRoot,
		relativePath: promotionRelativePath(slug, request.directory),
	};
	const checkout = await createDurableAdrFile(provenance, adr);
	const sourceIds = sources.map((source) => source.id);
	const promotion = promotionFrom(checkout, sourceIds, slug);
	const nextState = attachDurablePromotion(state, promotion);
	return { state: nextState, promotion, absolutePath: checkout.absolutePath, adr };
}

function requirePromotion(state: LedgerState, reference: string, verb: string): DurablePromotion {
	const promotion = findRegisteredAdr(state, reference);
	if (promotion === undefined) throw new Error(`unknown ADR slug or UUID: ${reference} (cannot ${verb})`);
	return promotion;
}

/** Read the authoritative file and confirm it still holds the same ADR identity. */
export async function checkoutPromotedDecision(state: LedgerState, reference: string): Promise<{ promotion: DurablePromotion; checkout: DurableCheckout; current: boolean }> {
	const promotion = requirePromotion(state, reference, "check out");
	const checkout = await checkoutDurableAdr({ repositoryRoot: promotion.repositoryRoot, relativePath: promotion.relativePath });
	if (checkout.id !== promotion.adrId) throw new Error(`${promotion.relativePath} holds ADR ${checkout.id}, not ${promotion.adrId}`);
	return { promotion, checkout, current: checkout.baseSourceFingerprint === promotion.baseSourceFingerprint };
}

/** The editable body of the working copy, refused unless it is a current draft. */
export async function promotedDraftBody(state: LedgerState, reference: string): Promise<string> {
	const { promotion, checkout, current } = await checkoutPromotedDecision(state, reference);
	if (!current) throw new Error(`${promotion.relativePath} changed since it was checked out; use /adr reload ${promotion.slug} to adopt the file first`);
	if (checkout.lifecycle !== "draft") throw new Error(`${promotion.relativePath} is ${checkout.lifecycle}; only draft ADRs can be edited`);
	return durableAdrBody(checkout.baseSource);
}

export type EditPromotionResult =
	| { ok: true; state: LedgerState; promotion: DurablePromotion; changed: boolean }
	| { ok: false; conflict: DurableConflict };

/**
 * Publish an exactly reviewed draft body against the working-copy base. Any
 * byte change to the file since checkout is a conflict; nothing is merged.
 */
export async function editPromotedDecision(state: LedgerState, reference: string, reviewedBody: string): Promise<EditPromotionResult> {
	const { promotion, checkout, current } = await checkoutPromotedDecision(state, reference);
	if (!current) {
		const fields = validateDurableAdrBody(reviewedBody);
		const patch = { ...fields, supersedes: [...checkout.adr.supersedes] };
		return { ok: false, conflict: sourceChangedConflict(promotion, checkout, patch, updateDurableAdr(promotion.baseSource, patch)) };
}
	if (checkout.lifecycle !== "draft") throw new Error(`${promotion.relativePath} is ${checkout.lifecycle}; only draft ADRs can be edited`);
	const result: DurablePublishResult = await publishDurableBody(checkout, reviewedBody);
	if (!result.ok) return result;
	const nextState = syncDurablePromotion(state, result.checkout);
	return { ok: true, state: nextState, promotion: findRegisteredAdr(nextState, promotion.slug)!, changed: result.changed };
}

/**
 * Explicitly adopt the authoritative file's current bytes as the new working-
 * copy base, for example after a direct edit. Identity must not change.
 */
export async function reloadPromotedDecision(state: LedgerState, reference: string, reviewedFingerprint?: string): Promise<{ state: LedgerState; promotion: DurablePromotion; changed: boolean }> {
	const { promotion, checkout, current } = await checkoutPromotedDecision(state, reference);
	if (reviewedFingerprint !== undefined && checkout.baseSourceFingerprint !== reviewedFingerprint) throw new Error("repository ADR changed while it was being reviewed; review it again before reloading");
	const nextState = current ? state : syncDurablePromotion(state, checkout);
	return { state: nextState, promotion: findRegisteredAdr(nextState, promotion.slug)!, changed: !current };
}

/**
 * Delete an unchanged repository draft and detach every source decision.
 * Source decisions remain available for a later promotion.
 */
export async function discardPromotedDraft(state: LedgerState, reference: string): Promise<{ state: LedgerState; promotion: DurablePromotion }> {
	const { promotion, checkout, current } = await checkoutPromotedDecision(state, reference);
	if (promotion.lifecycle !== "draft" || checkout.lifecycle !== "draft") throw new Error(`${promotion.relativePath} is ${checkout.lifecycle}; only an unchanged draft can be discarded`);
	if (!current) throw new Error(`${promotion.relativePath} changed since it was checked out; refusing to discard it`);
	await deleteDurableDraft(checkout);
	const nextState = cloneState(state);
	nextState.adrs = (nextState.adrs ?? []).filter((adr) => adr.adrId !== promotion.adrId);
	for (const item of nextState.ledger?.items ?? []) {
		if (item.adrId === promotion.adrId) delete item.adrId;
	}
	return { state: nextState, promotion };
}

function sourceChangedConflict(promotion: DurablePromotion, checkout: DurableCheckout, patch: DurableConflict["patch"], proposedSource: string): DurableConflict {
	return {
		kind: "conflict",
		reason: "source-changed",
		absolutePath: checkout.absolutePath,
		id: checkout.id,
		base: {
			semanticDigest: promotion.baseSemanticDigest,
			sourceFingerprint: promotion.baseSourceFingerprint,
			source: promotion.baseSource,
		},
		actual: {
			semanticDigest: checkout.baseSemanticDigest,
			sourceFingerprint: checkout.baseSourceFingerprint,
			source: checkout.baseSource,
			bytesBase64: Buffer.from(checkout.baseSource, "utf8").toString("base64"),
		},
		patch,
		proposedSource,
	};
}

export type AcceptPromotionResult =
	| { ok: true; state: LedgerState; promotion: DurablePromotion; changed: boolean }
	| { ok: false; conflict: DurableConflict };

/** The explicit draft -> accepted transition for an already promoted decision. */
export async function acceptPromotedDecision(state: LedgerState, reference: string): Promise<AcceptPromotionResult> {
	const { promotion, checkout, current } = await checkoutPromotedDecision(state, reference);
	if (!current) {
		return { ok: false, conflict: sourceChangedConflict(promotion, checkout, { lifecycle: "accepted" }, updateDurableAdr(promotion.baseSource, { lifecycle: "accepted" })) };
	}
	const result = await acceptDurableAdr(checkout);
	if (!result.ok) return result;
	const nextState = syncDurablePromotion(state, result.checkout);
	return { ok: true, state: nextState, promotion: findRegisteredAdr(nextState, promotion.slug)!, changed: result.changed };
}
