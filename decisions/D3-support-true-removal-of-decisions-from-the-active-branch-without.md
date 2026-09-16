---
id: "D3"
lifecycle: "resolved"
title: "Support true removal of decisions from the active branch without adding an archive subsystem."
---

# Support true removal of decisions from the active branch without adding an archive subsystem.

- **Decision ID:** `D3`
- **Lifecycle:** `resolved`

## Decision point

Implement removal of decisions from the decision ledger.

## Decision / outcome

Support true removal of decisions from the active branch without adding an archive subsystem.

## Context

Accidental, duplicate, or mock decisions should be removable from the current ledger, while ignored decisions should remain visible as deliberate historical outcomes.

## Options considered

- Keep every decision permanently
- Add a separate archive subsystem
- Remove decisions from current ledger state while relying on branch history

## Consequences

Removal hides the item from the current widget and ledger. IDs are never reused. Earlier session snapshots retain the item, so navigating backward can restore it naturally. Removal of an actively explored decision is refused.

## Follow-ups

- Add an atomic remove operation accepting one or more IDs
- Add a confirmed removal command with ID completion
- Require an explicit user request before agent-initiated removal

