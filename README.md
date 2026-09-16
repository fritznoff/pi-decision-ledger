# pi-decision-ledger

A deliberately small Pi package for tracking user-resolvable decisions in the active session and conversation branch.

## Install

From a local checkout:

```bash
pi install git:github.com/fritznoff/pi-decision-ledger@v0.5.0
```

For a one-off test:

```bash
pi -e git:github.com/fritznoff/pi-decision-ledger@v0.5.0
```

The package provides one extension, the `decision_ledger` agent tool, and the bundled `decision-ledger` Agent Skill.

## Use

- `/decisions` — open the complete, navigable ledger in TUI (or show a concise complete overview headlessly)
- `/decisions export` — emit a complete Markdown export of every current-branch decision without writing a file or triggering a model turn
- `/decision capture` — ask the main agent to extract decision points from its last reply
- `/decision explore <ID>` — focus one item for exploration
- `/decision remove <ID> [<ID> ...]` — confirm removal from the current branch; removed IDs are never reused
- `/decision return` — review and finalize the latest proposal for the focused exploration
- `/decision exit` — explicitly leave exploration without resolving it
- `/decisions recover` — explicitly copy the newest off-branch snapshot when this branch has no ledger

Interactive `/decision` completion is decision-only: it completes subcommands and current decision IDs (including forced Tab completion), ranks `return` before `remove` for the shared `re` prefix, and never falls through to filesystem paths in decision contexts. Completion values remain raw while ID labels use `[ID]` and concise title descriptions.

New decision IDs are random three-character uppercase alphanumeric values. Existing sessions with historical IDs continue to load unchanged; historical IDs are not rewritten. Human-facing Markdown and prose render references as code-like tokens such as `ABC` and `123`; interactive TUI rows use bracketed tokens such as `[ABC]` with the active accent when a theme is available. Stored IDs, tool fields, command arguments, completion values, and lookup keys remain raw; completion labels use the bracketed TUI form such as `[ABC]`.

Each new item requires a concise `title` (a few meaningful words) and a complete `point`. Titles are stable display labels used by the widget and compact selector rows. Details and exports retain both the title and the complete point. Legacy snapshots without `title` remain valid and deterministically use the full point as their display title; history is not rewritten.

The `add` action defaults each item to `open`. It may capture an initial `proposed`, `resolved`, `deferred`, or `ignored` lifecycle only when the user already supplied or explicitly accepted that state or outcome; agents must not silently resolve decisions while adding them. `proposed`, `resolved`, and `ignored` require a complete record, `deferred` may include one, and `open` must not include one. `exploring` is never valid on add because it requires a live conversation bookmark; use `explore` instead. Proposed items retain their exact generated Markdown draft independently, so multiple proposed items can be revised, explored, replayed, and returned without sharing one proposal.

The six public lifecycles are `open`, `exploring`, `proposed`, `resolved`, `deferred`, and `ignored`. `resolved` is the successful terminal state. `ignored` is a separate terminal state shown with `−`, dimmed and struck through. Legacy snapshots are accepted in memory: `resolution_proposed` becomes `proposed`, and legacy status fields are converted to the corresponding lifecycle without rewriting the original snapshot.

The TUI uses symbolic markers: open `○`, exploring `◉`, proposed `◇`, resolved `✓`, deferred `⏸`, and ignored `−`. The bottom session widget shows only actionable rows (`open`, `exploring`, and `proposed`) and always displays `Decisions: N/M completed`, where completed means resolved or ignored. It keeps at most five rows and truncates titles only during width-aware rendering. `/decisions` remains complete and includes resolved, ignored, and deferred rows; open rows come first, ignored rows last, and relative order is stable.

The selector keeps Enter for details and Esc/Ctrl+C for close. It also supports `e` explore, `a` accept/review, `i` ignore, `r` reopen, `f` defer, Delete (including Pi's terminal delete encodings) remove, and `?` help. Acceptance, ignoring, and removal ask for confirmation. An explored proposal always uses Markdown review and `/decision return`; a lightweight proposal can be accepted directly with its complete record. Invalid actions explain why and leave the selector usable.

When a reviewed explored proposal is valid, the exact reviewed Markdown is first persisted as a proposed state on the exploration branch and as a hidden, context-bearing custom message. That lets Pi's branch summarizer see the draft without an unwanted model turn or duplicate transcript UI. Before that persistence starts, TUI mode shows a temporary animated, theme-aware `Summarizing decision and returning` widget; it is disposed on every success, cancellation, error, shutdown, reload, and early exit. The generated return handoff is complementary: it asks only for additional evidence or references, unresolved caveats or risks, effects on other work, and immediate continuation context. If there is nothing additional, it requests one brief no-additional-context statement. The resolved record is written on the destination branch only after navigation succeeds. Cancellation, rejection, repeated tree events, and reload preserve the proposed state and reviewed draft.

A proposed item without an exploration bookmark can enter focused exploration while retaining its exact record and Markdown draft. `/decision exit` restores that lightweight proposal; an open exploration exits back to open. Switching, cancellation, branch replay, and navigation failure do not finalize or discard the proposal. Starting, switching, exiting, and successfully resolving focus append one durable, visible transition message with the formatted ID and concise title. Each LLM call also receives one final hidden, non-persisted focus marker derived from the live branch; it is replaced on every call and explicitly disambiguates references such as this, it, the decision, and the proposal.

Interactive details have a compact lifecycle-and-ID header, followed by the concise title and an unbounded complete body. The body contains the full point and each decision-record section once. Tool detail output remains safely bounded at its documented limit; `/decisions export` is the untruncated path.

The export is a full, untruncated Markdown document containing every current-branch item's ID, lifecycle, title, point, and complete record fields. Items without records are marked explicitly. It omits exploration bookmarks, ID reservations, session-entry metadata, removed items, and off-branch snapshots. In TUI mode, it is delivered as a visible custom message rendered as Markdown. In JSON and RPC modes, it is exposed as visible custom-message events containing the Markdown; clients are responsible for rendering it. The command does not trigger a model turn; print mode writes it to stdout.

## Development

```bash
npm install
npm test
```

`npm test` runs TypeScript checking and focused Vitest tests. The Pi packages are peer dependencies at runtime and are regular development dependencies here for local checking.

## Filesystem caveat

Ledger state is stored only in Pi session entries: tool-result details, state custom entries, and hidden context-bearing custom messages used for reviewed-draft handoffs. There is no database, project data file, ADR file, or automatic filesystem rollback. `/tree` changes conversation state and honestly rewinds the branch-visible ledger; it does not undo or claim to undo filesystem changes. Removing an item only changes the current branch state; earlier snapshots naturally retain it.
