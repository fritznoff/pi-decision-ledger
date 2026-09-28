---
status: accepted
x-pi-decision-ledger:
  version: 1
  id: bdc65088-7ba6-4b56-9127-6a5c4ef020a1
  semanticDigest: sha256:3182604fb65f4d879fc5025b02d09d2463e062b6db2ef02c90fc04f71605972c
  supersedes: []
  supersededBy: []
---

# Separated decision state model

## Context and Problem Statement

Consolidate the durable state-machine contract that separates descriptive metadata updates, proposal records, lifecycle transitions, and orthogonal focused-exploration bookmarks, including strict atomic creation and legacy lifecycle normalization.

The earlier API allowed update, proposal creation, lifecycle changes, and exploration state to overlap. That coupling made validation, replay, and branch navigation difficult to reason about, especially when a lightweight proposal needed further exploration rather than immediate acceptance or rejection.

## Considered Options

- Keep one broad update operation and model exploration as a lifecycle
- Restrict metadata updates but keep proposals and exploration coupled to lifecycle
- Separate metadata, proposal records, lifecycle transitions, and exploration bookmarks

## Decision Outcome

Model decision lifecycle, proposals, metadata, and exploration as separate concerns. Restrict update to title and point; use propose for candidate records; use explicit lifecycle actions; use open, proposed, resolved, deferred, and ignored as lifecycle states without a separate disposition; and represent focused exploration as an orthogonal bookmark that may coexist with open or proposed state. Allow add to capture validated initial lifecycle and record data atomically, but never create exploration without a live return bookmark.

### Consequences

The public API and state machine have clearer ownership and validation boundaries. Lightweight proposals can be accepted, rejected, or explored without losing their record. Exploration exit clears only the bookmark, while return performs exact review and resolution. Initial batch creation is atomic and lifecycle-aware. Legacy lifecycle and disposition values require deterministic replay normalization.