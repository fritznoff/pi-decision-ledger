---
id: "D2"
lifecycle: "resolved"
title: "Render decision states with compact symbols and semantic styling: open ○, exploring ◉, resolution proposed ◇, resolved ✓, deferred ⏸, and ignored −. An ignored disposition overrides the generic resolved symbol and strikes through only the decision point."
---

# Render decision states with compact symbols and semantic styling: open ○, exploring ◉, resolution proposed ◇, resolved ✓, deferred ⏸, and ignored −. An ignored disposition overrides the generic resolved symbol and strikes through only the decision point.

- **Decision ID:** `D2`
- **Lifecycle:** `resolved`

## Decision point

Design a nicer TUI for open decisions using clear symbols instead of textual status markers such as [exploring] and [open].

## Decision / outcome

Render decision states with compact symbols and semantic styling: open ○, exploring ◉, resolution proposed ◇, resolved ✓, deferred ⏸, and ignored −. An ignored disposition overrides the generic resolved symbol and strikes through only the decision point.

## Context

Textual markers such as [open] and [exploring] make the compact ledger visually noisy. The active exploration should be strongest, valid resolved decisions should remain readable, and intentionally discarded decisions should look inactive without losing their history or selectability.

## Options considered

- Keep textual lifecycle and disposition markers
- Use symbols without styling
- Use symbols with semantic color, emphasis, dimming, and ignored-only strikethrough

## Consequences

The compact table and widget become easier to scan. Symbols must remain meaningful without color, ignored rows remain selectable, and full textual lifecycle/disposition values stay available in the detail view.

## Follow-ups

- Implement the shared effective-state-to-symbol and styling mapping
- Use the mapping in both the widget and interactive decision list
- Add focused rendering tests, including resolved plus ignored precedence and terminal width bounds

