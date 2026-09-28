---
status: accepted
x-pi-decision-ledger:
  version: 1
  id: aa1fc8f0-dbc6-447b-8fa2-80af48e247bb
  semanticDigest: sha256:8d0a995e18bf96a39c70ff99d5bb0a88d08a1c28c1daf7b8d28d9cffe6d761b9
  supersedes: []
  supersededBy: []
---

# Branch-local ledger identity

## Context and Problem Statement

Consolidate the durable identity and branch-state contract for random decision IDs, current-branch removal, replay history, and human-readable current-branch export.

Sequential IDs couple identity to ordering and collide easily across independently evolving branches. A branch-local ledger also needs honest removal and export semantics: current state may omit an item without pretending historical snapshots disappeared, and human exports should not expose internal replay machinery.

## Considered Options

- Use sequential IDs and keep every decision permanently visible
- Add a separate archive and export every session branch
- Use opaque random IDs with branch-local removal, historical replay, and current-branch Markdown export

## Decision Outcome

Keep the decision ledger branch-local in Pi session state. Allocate random three-character uppercase alphanumeric IDs, reject collisions, and never reuse IDs recorded by the session. Removing a decision changes only current branch state while earlier snapshots retain it. Export only the complete current branch as human-readable Markdown and exclude replay internals and off-branch history.

### Consequences

Visible identities are order-independent and collision-checked. Accidental or duplicate items can be removed without an archive subsystem, while ignored decisions remain deliberate history. Backward navigation can naturally restore earlier snapshots. Exports remain readable and bounded to the branch the user is actually viewing.