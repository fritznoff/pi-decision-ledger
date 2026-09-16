---
id: "275"
lifecycle: "resolved"
title: "Show only actionable decisions in the bottom session widget, while `/decisions` continues to show the complete ledger."
---

# Show only actionable decisions in the bottom session widget, while `/decisions` continues to show the complete ledger.

- **Decision ID:** `275`
- **Lifecycle:** `resolved`

## Decision point

Prioritize actionable decisions in the bottom session widget while keeping the full `/decisions` ledger available.

## Decision / outcome

Show only actionable decisions in the bottom session widget, while `/decisions` continues to show the complete ledger.

## Context

The compact widget should emphasize current work, but the interactive `/decisions` ledger must retain resolved, ignored, and deferred rows so users can inspect and reopen them.

## Options considered

- Hide terminal and deferred decisions from both widget and `/decisions`
- Hide them only from the bottom widget
- Never hide completed decisions

## Consequences

The widget shows open, exploring, and proposed decisions only, with open decisions first and stable relative ordering. Its heading reads `Decisions: N/M completed`, where completed counts resolved and ignored items and M counts all current decisions. `/decisions` shows every item, keeps open decisions first, keeps ignored decisions last, and supports reopening hidden-from-widget rows.

## Follow-ups

- Test widget filtering and counts independently from full-ledger selector ordering
- Preserve complete export and branch replay behavior

