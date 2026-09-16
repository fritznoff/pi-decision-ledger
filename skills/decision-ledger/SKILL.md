---
name: decision-ledger
description: Use the session- and branch-scoped decision ledger when a conversation contains user-resolvable choices, competing approaches, or an exploration that needs a focused return. Keep the ledger compact and ask the user rather than deciding for them.
---

# Decision ledger protocol

Use the `decision_ledger` tool for decision state. It is scoped to the active Pi session and current conversation branch; it is not a project file or database.

## Identify decision-bearing points

A decision-bearing point is a choice, confirmation, preference, or unresolved trade-off that belongs to the user. Do not create ledger items for routine implementation details the agent can safely choose. When one or more user-resolvable points are present, call `decision_ledger` with an `add` action before presenting them; when there are two or more, use one `add` action containing all points so the batch is atomic.

Every new add item must include:

- `title`: a minimal meaningful phrase, preferably a few words, used as the stable compact display label
- `point`: the complete precise decision point; do not shorten it to fit a widget
- optional `lifecycle` and `record` only when the user already supplied or explicitly accepted that initial state or outcome

Omitting `lifecycle` creates an `open` item. Initial `proposed`, `resolved`, and `ignored` items require a complete five-field `record`; `deferred` may include a record; `open` must not include one. `exploring` is never valid on add because it requires a live conversation return bookmark—use the existing `explore` transition instead. A proposed add item stores its exact canonical Markdown draft on that item, so multiple proposed items retain independent drafts through acceptance, exploration, revision, replay, and return. Add validation is atomic: one invalid item rejects the entire batch without items, IDs, drafts, or partial state.

Use the returned raw IDs when calling tools and commands. Human-facing Markdown and prose show IDs as code-like tokens such as `ABC` or `123`; the interactive TUI uses bracketed tokens such as `[ABC]`. Legacy snapshots without a title use their full point as the display-title fallback. Stored IDs, TypeBox fields, command arguments, completion values, and lookup keys stay raw; completion labels use the bracketed TUI form.

Accept terse replies such as “the first option” or “defer the rollout.” Interpret them against the current ledger, ask one concise clarification when needed, and do not silently choose for the user. Record grouped answers with one `update` action so the batch is atomic. Use only these lifecycles: `open`, `exploring`, `proposed`, `resolved`, `deferred`, and `ignored`. Never infer an initial outcome on `add`; use an initial non-open lifecycle only when the user's message already supplied or accepted it. `resolved` is the only successful terminal state; `ignored` is a separate terminal lifecycle. `record.followUps` is the only follow-up metadata.

## Removal

Use `decision_ledger` action `remove` only after the user explicitly requests removal, and set `userRequested` to true only for that request. Pass one or more raw IDs in `ids`; removal is atomic and affects only the current branch. Never remove an actively explored decision. IDs are never reused, and earlier snapshots naturally retain removed items. For an interactive request, prefer `/decision remove <ID> [<ID> ...]`, which asks for confirmation.

## Focused exploration

When a decision needs investigation, use `decision_ledger` action `explore` when the user explicitly and unambiguously asks to explore a specific decision. If the target is ambiguous, ask one concise clarification rather than guessing. Only one focused exploration may be active. A direct `/decision explore <ID>` switches focus after safely exiting the previous exploration; `/decision exit` explicitly abandons the current focus. Unrelated prompts are still allowed while focus is active.

An open item becomes `exploring`. A lightweight `proposed` item can also enter focused exploration: keep its existing record and Markdown proposal, and retain them when the exploration is exited or switched away. Explicitly exiting an open exploration returns it to `open`; explicitly exiting a proposal exploration restores `proposed` and the exact draft. Cancellation, branch replay, and failed navigation must not finalize or discard that proposal. Starting or switching focus appends one concise, visible, durable transition containing the formatted ID, concise title, and full point. Exiting and successful return append one corresponding cleared/resolved transition. On every LLM call, the extension derives focus from the live branch, removes an earlier hidden marker, and appends one final hidden marker only while focus is active. The marker names the ID, title, and point, disambiguates this/it/the decision/the proposal unless the current user message identifies another subject, and says that a recently resolved decision does not regain focus.

Only the focused decision receives a soft focus reminder on each agent turn. Keep work centered on its point, but do not reject unrelated work. Honor explicit requests to switch or exit. `/tree` changes conversation state, not files, and does not undo edits.

After investigating, use `decision_ledger` action `propose` with a minimal record for the focused item. In interactive TUI mode, `/decision return` shows an animated theme-aware `Summarizing decision and returning` widget immediately after valid Markdown review and before draft persistence/navigation; it is cleared on success, cancellation, errors, shutdown, reload, and early exits. It is not shown in headless modes and does not replace Pi's native follow-up loader.

Include all five fields:

- `decision`: the proposed decision or outcome
- `context`: why the decision was needed and relevant evidence
- `optionsConsidered`: the meaningful alternatives considered
- `consequences`: important effects and trade-offs
- `followUps`: concrete follow-up actions, or an empty list

Do not mark an explored item resolved in the proposal. Then ask the user to run `/decision return`. That command opens the latest compact Markdown record for review/editing, persists the exact valid reviewed draft while the item remains proposed, and adds it to branch context through a hidden custom message so Pi's summarizer can see it without an unwanted model turn or duplicate UI. It then navigates back with a narrowly focused complementary handoff. The handoff must not repeat the record's decision, context, options, consequences, or follow-ups. It asks only for additional evidence or references, unresolved caveats or risks, effects on other work, and immediate context needed to continue; if nothing additional exists, it gives one brief no-additional-context statement. The finalized record is written and resolved only after successful navigation. Successful return uses the reviewed record directly rather than parsing or regenerating it from the summary.

An open item may also receive a lightweight proposal through `propose`. It has no exploration bookmark. Accept it with an ordinary `update` to `resolved` (the full record is retained), or reject it with an ordinary `update` to `open` (the draft is cleared). A lightweight proposal may later be explored without losing its record or Markdown draft. An explored proposal must go through Markdown review and `/decision return`; do not bypass that flow.

## Dashboard discipline

Use `decision_ledger` action `list` or `/decisions` to view the complete dashboard. `/decisions` includes resolved, ignored, and deferred rows so terminal items can be reopened. The bottom session widget is different: it shows only `open`, `exploring`, and `proposed` rows, with open rows first, stable order within lifecycle groups, and a `Decisions: N/M completed` progress heading. N counts resolved and ignored; deferred is not completed. The widget displays concise titles and keeps no more than five decision rows; truncation is based on actual terminal width and occurs only at render time. If no actionable rows remain, the progress heading still appears.

The selector supports Enter for details and Esc/Ctrl+C to close. It also supports `e` explore, `a` accept/review, `i` ignore, `r` reopen, `f` defer, Delete to remove, and `?` help. Acceptance, ignoring, and removal are confirmed interactively. Invalid actions report a concise reason without closing the selector. Destructive transitions are refused while exploration is active; use `/decision return` or `/decision exit` first.

The extension layers decision-only autocomplete over Pi's provider during TUI session setup. It intercepts `/decision` subcommands and `explore`/`remove` ID positions even for forced Tab completion, ranks `return` before `remove` for `re`, returns only matching current IDs while excluding already-selected remove IDs, and keeps raw completion values with bracketed `[ID]` labels and concise title descriptions. ID contexts suppress filesystem suggestions; unrelated commands, normal text, and explicit paths delegate unchanged.

Interactive details show a compact lifecycle symbol/state and bracketed ID header, then the concise title, then the complete unbounded body. The body contains the full point and every decision-record section exactly once, without nested record headings, proposal boilerplate, return-label metadata, or repeated lifecycle/ID metadata. Use `decision_ledger` action `detail` for one safely bounded tool record when needed; do not expand every record in a list. Use `/decisions export` when the user asks for the complete current-branch ledger; it includes every current item, title, full point, and all complete record fields, explicitly marks missing records, omits extension internals, and does not trigger a model turn. Ignored decisions remain dimmed and struck through and are shown last in ordered user-facing lists. This ordering is presentation-only: canonical item order, branch replay, and export completeness are unaffected. If `/tree` changes or removes the ledger, respect the selected branch; do not import state automatically. Use `/decisions recover` only after explicit confirmation when the current branch has no ledger.
