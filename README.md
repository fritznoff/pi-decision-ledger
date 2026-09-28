# pi-decision-ledger

A deliberately small Pi package for tracking user-resolvable decisions in the active session and conversation branch.

## Install

From a local checkout:

```bash
pi install git:github.com/fritznoff/pi-decision-ledger@v0.6.0
```

For a one-off test:

```bash
pi -e git:github.com/fritznoff/pi-decision-ledger@v0.6.0
```

The package provides one extension, the `decision_ledger` agent tool, the bundled `decision-ledger` Agent Skill, a separate durable ADR core in `src/durable.ts`, and repository-backed durable access in `src/durable-repository.ts`.

The durable core is deliberately bounded. Its native v1 format uses the official MADR 4.0 bare-minimal body: Context and Problem Statement, Considered Options, Decision Outcome, and nested Consequences. It emits MADR's top-level `status` as the authoritative lifecycle (`proposed`, `accepted`, or `superseded`) and keeps only Pi-specific UUID, digest, schema version, and supersession links under `x-pi-decision-ledger`. Optional MADR `date`, `decision-makers`, `consulted`, and `informed` metadata is emitted only when known. It does not generate a Follow-ups section. This experimental v1 has no migration compatibility commitment yet.

## Repository-backed durable ADRs

`src/durable-repository.ts` is a small filesystem module over that core. It defines how callers treat repository authority and how a repository file may change; it does not decide when or whether anything should become durable. These are library primitives, not integrated session commands or automatic session-to-repository synchronization.

Authority is simple. Session ledger state is authoritative until a repository ADR draft exists. Once the file exists, callers must treat the file as authoritative and anything held in a session as a working copy carrying the durable UUID, its repository provenance, the base semantic digest, an exact-byte source fingerprint, and the original source. Checkouts snapshot and freeze provenance, resolving the repository root to its physical path; symlinked directories and files below that root are refused. Transferring authority to the repository does not accept the ADR.

A repository draft stays mutable, but only through conflict-checked publishing, and its UUID never changes as it is edited or later accepted. `checkoutDurableAdr` reads the authoritative file, validating UTF-8 rather than replacing invalid bytes. `publishDurablePatch` applies the caller's patch to the checkout base, then rereads the authoritative file and requires it to match that base byte for byte. Any difference — including a semantically irrelevant one such as an added comment — blocks the write and returns a structured conflict containing the base, the observed on-disk state, the caller's patch, and the proposed source. Invalid UTF-8 is retained as base64 bytes, and unreadable files are distinguished from missing files. Write failures also carry the patch and proposed source. Nothing is ever merged or overwritten automatically. Recovery is explicit: `reloadDurableCheckout` rereads the file and returns a fresh checkout, refusing a file that no longer carries the same durable identity, and the caller decides what to republish.

When the base verifies, the patch is applied to the freshly verified source through the core's targeted region replacement and written with a same-directory temporary file and a rename, copying the existing file mode and removing the temporary file on any failure. The rename is atomic on POSIX filesystems, but the checks are optimistic, not a lock or atomic compare-and-swap. A final recheck catches changes during preparation; an external writer can still race the last check and rename. Callers must coordinate concurrent writers and directory changes. Path checks likewise do not defend against an adversary concurrently replacing directories.

`createDurableAdrFile` validates a draft before touching disk, prepares a complete same-directory temporary file, and publishes it with an exclusive hard link: an existing file is never replaced or inspected. Creation does not implement review policy. `acceptDurableAdr` is an explicit internal `draft` -> `accepted` transition that rereads, imports and verifies the ADR and changes only top-level MADR `status: proposed` to `status: accepted`; an equivalent manual YAML edit is recognized on the next import and left byte-identical.

Deliberately not implemented here: rejected or abandoned durable lifecycle states (an unchanged draft can only be discarded, see below), governance or reviewer roles, dependency graphs between ADRs, repository browsing, and implementation evidence.

## Promotion

Promotion turns significant session decisions into repository ADR drafts. It is explicit and selective: the extension never promotes automatically and applies no significance classifier. The skill recommends when promotion is worthwhile; the user decides.

`/decision promote <ID> [<ID> ...] [--slug <slug>] [--repo <path>]` takes an explicit, ordered source set of `open`, `proposed`, or `resolved` decisions. After promotion, the ADR is managed independently by its stable repository-local slug.

- **Candidate.** Grouping and wording are the skill's job, not the extension's. The agent synthesizes one coherent ADR and calls the `decision_ledger` action `promote_adr` once with ordered `ids`, exact envelope-free `markdown`, and optional slug and repository. The action validates the sources, opens mandatory exact Markdown review, and writes only after user approval. Cancellation writes nothing and assigns no identity. `/decision promote` is a direct user convenience for deterministic one-source promotion; multi-source promotion always requires agent-synthesized Markdown. There is no persisted staging state or mechanical concatenation.
- **Repository.** Without `--repo`, the ADR goes to the nearest Git root containing the working directory (a `.git` directory or file). Outside any Git repository, promotion refuses before review and asks for `--repo <path>`. An explicit path is resolved against the working directory, canonicalized, and must itself be a Git root. Nested repositories are never searched.
- **Review and write.** The command opens the candidate for review. That reviewed text is the sole input to validation, the semantic digest, and the written file; cancelling or failing validation writes nothing, assigns no durable UUID, and transfers no authority. A successful promotion derives a lowercase kebab-case slug from the reviewed title unless `--slug` supplies one, writes `decisions/<slug>.md` exclusively, and registers the ADR independently from its source decisions. The UUID inside the file remains canonical identity. The slug and path stay stable when the draft title changes. Slug or path collisions refuse promotion.

Promoted decisions keep their session lifecycle and show a separate ADR badge. The first-class ADR registry survives removal of those source decisions and retains the UUID, slug, repository, path, lifecycle, working-copy base, and frozen source IDs. `/adrs` lists registered ADRs. Human operations use `/adr <action> <slug>`; an exact UUID is accepted as a machine fallback, but source decision IDs are not ADR handles.

A draft can be revised or retried explicitly:

- `/adr edit <slug>` opens the editable body of a current draft and publishes it with exact-byte conflict checking.
- `/adr reload <slug>` explicitly adopts the authoritative file's current bytes after review.
- `/adr discard <slug>` deletes only an unchanged draft, removes its registry entry, and detaches surviving source decisions. The decisions remain available for a later promotion.
- `/adr accept <slug>` performs the explicit proposed-to-accepted transition after confirmation.

Removing source decisions does not remove or hide their ADR. Automatic title edits never rename the slug or file; any future rename operation is a separate feature.

## Use

- `/decisions` — open the complete, navigable ledger in TUI (or show a concise complete overview headlessly)
- `/decisions export` — emit a complete Markdown export of every current-branch decision without writing a file or triggering a model turn
- `/decision capture` — ask the main agent to extract decision points from its last reply
- `/decision explore <ID>` — focus one item for exploration
- `/decision promote <ID> [<ID> ...] [--slug <slug>] [--repo <path>]` — review and write an ADR from explicit source decisions
- `/adrs` — list first-class repository ADRs and their stable slugs
- `/adr edit <slug>` — review and publish an edit of a repository draft
- `/adr reload <slug>` — adopt the current bytes of the repository file after a direct edit
- `/adr discard <slug>` — delete an unchanged draft and remove its registry entry
- `/adr accept <slug>` — accept a repository ADR
- `/decision remove <ID> [<ID> ...]` — confirm removal from the current branch; removed IDs are never reused
- `/decision return` — review and finalize the latest proposal for the focused exploration
- `/decision exit` — explicitly leave exploration without resolving it
- `/decisions new` — start a fresh session carrying only the active branch's ledger; active explorations must first be returned or exited
- `/decisions recover` — explicitly replace the current ledger with the newest off-branch snapshot after confirmation

Interactive `/decision` completion remains decision-only and suggests `--slug` and `--repo` during promotion. `/adr` completion lists actions and registered slugs, including slug suggestions immediately after an exact action such as `/adr accept`; it suppresses generic path completion and never offers source decision IDs. Suggestions are lifecycle-aware: edit, discard, and accept offer drafts, while reload offers every registered ADR. Completion values remain raw while decision labels use `[ID]` and concise title descriptions.

New decision IDs are random three-character uppercase alphanumeric values. Existing sessions with historical IDs continue to load unchanged; historical IDs are not rewritten. Human-facing Markdown and prose render references as code-like tokens such as `ABC` and `123`; interactive TUI rows use bracketed tokens such as `[ABC]` with the active accent when a theme is available. Stored IDs, tool fields, command arguments, completion values, and lookup keys remain raw; completion labels use the bracketed TUI form such as `[ABC]`.

Each new item requires a concise `title` (a few meaningful words) and a complete `point`. Titles are stable display labels used by the widget and compact selector rows. Details and exports retain both the title and the complete point. Legacy snapshots without `title` remain valid and deterministically use the full point as their display title; history is not rewritten.

The `add` action defaults each item to `open`. It may capture an initial `proposed`, `resolved`, `deferred`, or `ignored` lifecycle only when the user already supplied or explicitly accepted that state or outcome; agents must not silently resolve decisions while adding them. `proposed`, `resolved`, and `ignored` require a complete record, `deferred` may include one, and `open` must not include one. Exploration is never an initial lifecycle: use `explore` to create a live bookmark. Proposed items retain their exact generated Markdown draft independently, so multiple proposals can be revised, explored, replayed, and returned without sharing one proposal.

The canonical lifecycles are `open`, `proposed`, `resolved`, `deferred`, and `ignored`. Focused exploration is an independent bookmark, not a lifecycle. `update` changes only `title` and/or `point`; it cannot change a lifecycle or record. `propose` creates or revises a candidate. `resolve` directly records a complete, user-approved outcome from `open`; `accept` and `reject` operate only on lightweight proposals. `defer`, `ignore`, and `reopen` are explicit disposition actions. An explored proposal must use `/decision return` and cannot be accepted or otherwise disposed directly.

The TUI uses symbolic markers: open `○`, focused open `◉`, proposed `◇`, focused proposed `◉`, resolved `✓`, deferred `⏸`, and ignored `−`. The bottom session widget shows only actionable rows (`open` and `proposed`) and always displays `Decisions: N/M completed`, where completed means resolved or ignored. While exploration is focused, the heading and single row identify the explored ID and show `Exploring`; no other decision rows or separate focus footer are shown. It keeps at most five rows otherwise and truncates titles only during width-aware rendering. `/decisions` remains complete and includes resolved, ignored, and deferred rows; open rows come first, ignored rows last, and relative order is stable. Legacy snapshots are accepted in memory: `exploring` is normalized to its bookmark's `open` or `proposed` origin, `resolution_proposed` becomes `proposed`, and legacy status fields are converted without rewriting the original snapshot.

The selector keeps Enter for details and Esc/Ctrl+C for close. It also supports `e` explore, `a` accept/review, `x` reject, `i` ignore, `r` reopen, `f` defer, Delete (including Pi's terminal delete encodings) remove, and `?` help. Acceptance, rejection, ignoring, and removal ask for confirmation. An explored proposal always uses Markdown review and `/decision return`; a lightweight proposal can be accepted or rejected directly. Invalid actions explain why and leave the selector usable.

When a reviewed explored proposal is valid, its reviewed Markdown is retained with the proposed decision as the exploration returns to the prior context. TUI mode shows a temporary animated, theme-aware `Summarizing decision and returning` widget while the transition is in progress. The generated return handoff asks only for additional evidence or references, unresolved caveats or risks, effects on other work, and immediate continuation context. If there is nothing additional, it requests one brief no-additional-context statement. The resolved record is written on the destination branch only after navigation succeeds. Cancellation, rejection, repeated tree events, and reload preserve the proposed state and reviewed draft.

A proposed item without an exploration bookmark can enter focused exploration while retaining its exact record and Markdown draft. `/decision exit` clears only the bookmark and preserves the underlying `open` or `proposed` state, record, and Markdown. Switching, cancellation, branch replay, and navigation failure do not finalize or discard the proposal. Starting, switching, exiting, and successfully resolving focus append one durable, visible transition message with the formatted ID and concise title. Successful focus starts do not also emit a transient yellow notification; errors still warn. Each LLM call also receives one final hidden, non-persisted focus marker derived from the live branch; it is replaced on every call and explicitly disambiguates references such as this, it, the decision, and the proposal.

Interactive details have a compact lifecycle-and-ID header, followed by the concise title and an unbounded complete body. The body contains the full point and each decision-record section once. Tool detail output remains safely bounded at its documented limit; `/decisions export` is the untruncated path.

The export is a full, untruncated Markdown document containing every current-branch item's ID, lifecycle, title, point, and complete record fields. Items without records are marked explicitly. It omits exploration bookmarks, ID reservations, session-entry metadata, removed items, and off-branch snapshots. In TUI mode, it is delivered as a visible custom message rendered as Markdown. In JSON and RPC modes, it is exposed as visible custom-message events containing the Markdown; clients are responsible for rendering it. The command does not trigger a model turn; print mode writes it to stdout.

## Development

```bash
npm install
npm test
```

`npm test` runs TypeScript checking and focused Vitest tests. The Pi packages are peer dependencies at runtime and are regular development dependencies here for local checking.

## Filesystem caveat

The session extension's ledger state is stored only in Pi session entries: tool-result details, state custom entries, and hidden context-bearing custom messages used for reviewed-draft handoffs. Ordinary `/new` starts with no ledger; `/decisions new` creates a fresh session and seeds it with an exact snapshot of the active branch's ledger, without copying conversation history. The session extension creates no database, project data file, or ADR file. The separate durable library writes repository files only when explicitly called; there is no automatic filesystem rollback. `/tree` changes conversation state and honestly rewinds the branch-visible ledger; it does not undo or claim to undo filesystem changes. Removing an item only changes the current branch state; earlier snapshots naturally retain it.
