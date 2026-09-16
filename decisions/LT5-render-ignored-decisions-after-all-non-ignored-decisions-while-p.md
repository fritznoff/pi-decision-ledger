---
id: "LT5"
lifecycle: "resolved"
title: "Render ignored decisions after all non-ignored decisions while preserving relative order within both groups."
---

# Render ignored decisions after all non-ignored decisions while preserving relative order within both groups.

- **Decision ID:** `LT5`
- **Lifecycle:** `resolved`

## Decision point

Sort ignored decisions to the bottom of the decision-ledger list while preserving the relative order of other decisions.

## Decision / outcome

Render ignored decisions after all non-ignored decisions while preserving relative order within both groups.

## Context

Ignored decisions remain useful history but should not compete visually with active and accepted decisions.

## Options considered

- Keep canonical order in every view
- Move ignored decisions to the bottom by mutating persisted state
- Apply stable ignored-last ordering only in presentation

## Consequences

Interactive lists and human-readable exports are easier to scan, while persisted branch state and replay ordering remain unchanged.

## Follow-ups

- (none)

