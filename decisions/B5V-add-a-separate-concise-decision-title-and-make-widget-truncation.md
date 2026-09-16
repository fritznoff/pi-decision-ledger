---
id: "B5V"
lifecycle: "resolved"
title: "Add a separate concise decision title and make widget truncation depend only on actual rendered TUI width."
---

# Add a separate concise decision title and make widget truncation depend only on actual rendered TUI width.

- **Decision ID:** `B5V`
- **Lifecycle:** `resolved`

## Decision point

Make widget decision labels concise and truncate them only according to the actual available TUI width.

## Decision / outcome

Add a separate concise decision title and make widget truncation depend only on actual rendered TUI width.

## Context

The current widget slices the full decision point at a fixed character count, causing premature truncation. Requiring the full point itself to be short would remove useful detail from decision records.

## Options considered

- Add a separate concise title
- Use the full decision point as the title
- Derive titles heuristically at render time

## Consequences

New decisions carry a short, stable display title while retaining the complete point for detail and export. Widget and compact list surfaces use the title. Legacy items without a title fall back to their point. The widget becomes width-aware and truncates by rendered terminal width, accounting for ID, symbol, spacing, and ANSI styling rather than a fixed character limit.

## Follow-ups

- Extend add/tool schemas, snapshots, formatting, skill guidance, and tests for concise titles
- Use a width-aware widget component and terminal display-width utilities
- Keep full points and records untruncated in detail and export views

