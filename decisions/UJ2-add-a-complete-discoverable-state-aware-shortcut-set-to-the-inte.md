---
id: "UJ2"
lifecycle: "resolved"
title: "Add a complete, discoverable, state-aware shortcut set to the interactive `/decisions` overview."
---

# Add a complete, discoverable, state-aware shortcut set to the interactive `/decisions` overview.

- **Decision ID:** `UJ2`
- **Lifecycle:** `resolved`

## Decision point

Add discoverable, state-aware keyboard actions to the interactive `/decisions` overview.

## Decision / outcome

Add a complete, discoverable, state-aware shortcut set to the interactive `/decisions` overview.

## Context

The overview currently supports navigation and details but requires leaving the list to perform common decision transitions.

## Options considered

- Complete state-aware shortcut set
- Minimal shortcut set
- Core actions only

## Consequences

The overview uses Enter for details, `e` to explore, `a` to accept or review a proposal, `i` to ignore, `r` to reopen, `f` to defer, Delete to remove, `?` for help, and Esc/Ctrl+C to close. Acceptance, ignore, and removal require confirmation. Explored proposals continue through Markdown return review. Invalid actions explain why they are unavailable for the selected lifecycle.

## Follow-ups

- Implement action dispatch without duplicating command transition logic
- Show available shortcuts in the footer or help overlay
- Add keyboard, confirmation, cancellation, and lifecycle-matrix tests

