---
id: "G6I"
lifecycle: "resolved"
title: "Export the complete current-branch ledger as human-readable Markdown."
---

# Export the complete current-branch ledger as human-readable Markdown.

- **Decision ID:** `G6I`
- **Lifecycle:** `resolved`

## Decision point

Define the decision-ledger export scope and format.

## Decision / outcome

Export the complete current-branch ledger as human-readable Markdown.

## Context

The active ledger is branch-local, while session history may contain repetitive or unrelated off-branch snapshots. The export is intended for reading and sharing rather than state restoration.

## Options considered

- Current branch as Markdown and JSON
- Current branch as Markdown only
- Current branch as JSON only
- All session branches

## Consequences

The export contains every current decision, lifecycle and disposition, point, and complete record, but excludes internal replay metadata and off-branch history.

## Follow-ups

- Add a `/decisions export` command that emits the Markdown export without writing files automatically

