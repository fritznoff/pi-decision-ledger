---
id: "D8"
lifecycle: "resolved"
title: "Use random three-character alphanumeric IDs instead of sequential IDs such as D1 and D2."
---

# Use random three-character alphanumeric IDs instead of sequential IDs such as D1 and D2.

- **Decision ID:** `D8`
- **Lifecycle:** `resolved`

## Decision point

Replace sequential decision IDs such as D1 and D2 with random three-character alphanumeric IDs.

## Decision / outcome

Use random three-character alphanumeric IDs instead of sequential IDs such as D1 and D2.

## Context

Sequential IDs are tied to ordering and make independent or branched ledgers more likely to use the same visible references.

## Options considered

- Keep sequential D-prefixed IDs
- Use random three-character alphanumeric IDs

## Consequences

IDs become order-independent and less collision-prone across branches, but generation must avoid ambiguous characters and detect collisions.

## Follow-ups

- Define the alphabet and collision retry behavior
- Migrate existing session snapshots without changing their historical IDs

