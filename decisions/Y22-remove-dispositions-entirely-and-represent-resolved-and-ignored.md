---
id: "Y22"
lifecycle: "resolved"
title: "Remove dispositions entirely and represent `resolved` and `ignored` as distinct terminal lifecycles."
---

# Remove dispositions entirely and represent `resolved` and `ignored` as distinct terminal lifecycles.

- **Decision ID:** `Y22`
- **Lifecycle:** `resolved`

## Decision point

Simplify decision status by removing the resolved disposition distinction and deciding how ignored outcomes should be represented.

## Decision / outcome

Remove dispositions entirely and represent `resolved` and `ignored` as distinct terminal lifecycles.

## Context

Chosen and accepted do not change behavior, follow-up work is already represented in decision records, and ignored is the only disposition with meaningful presentation and ordering semantics.

## Options considered

- Use resolved and ignored terminal lifecycles
- Retain dispositions internally but hide them
- Keep lifecycle and disposition separate

## Consequences

All successful decisions display simply as resolved. Ignored decisions remain visibly distinct and sort last. Existing snapshots normalize chosen, accepted, and follow_up to resolved, and normalize resolved/ignored to the ignored lifecycle without rewriting stored history.

## Follow-ups

- Update schemas, transitions, formatting, sorting, tests, documentation, and replay normalization
- Keep legacy disposition fields readable during migration but stop producing them

