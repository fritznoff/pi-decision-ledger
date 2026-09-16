---
id: "HII"
lifecycle: "resolved"
title: "Rename `resolution_proposed` to `proposed`."
---

# Rename `resolution_proposed` to `proposed`.

- **Decision ID:** `HII`
- **Lifecycle:** `resolved`

## Decision point

Rename the `resolution_proposed` lifecycle to a simpler status label.

## Decision / outcome

Rename `resolution_proposed` to `proposed`.

## Context

Lifecycle values describe the current state of a decision. The existing name is unnecessarily long, especially in the compact ledger.

## Options considered

- Keep `resolution_proposed`
- Rename it to `proposal`
- Rename it to `proposed`

## Consequences

`proposed` is concise and grammatically consistent with state-oriented lifecycle names such as resolved, deferred, and ignored. Legacy snapshots using `resolution_proposed` must normalize to `proposed` during replay.

## Follow-ups

- Update schemas, transitions, rendering, tests, documentation, and legacy replay normalization

