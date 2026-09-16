---
id: "WN7"
lifecycle: "resolved"
title: "Render decision IDs as code-like tokens everywhere, using backticks in Markdown/plain text and theme accent styling in interactive TUI surfaces."
---

# Render decision IDs as code-like tokens everywhere, using backticks in Markdown/plain text and theme accent styling in interactive TUI surfaces.

- **Decision ID:** `WN7`
- **Lifecycle:** `resolved`

## Decision point

Make decision IDs visually distinct everywhere so legacy numeric-looking IDs cannot be mistaken for ordinary numbers.

## Decision / outcome

Render decision IDs as code-like tokens everywhere, using backticks in Markdown/plain text and theme accent styling in interactive TUI surfaces.

## Context

Three-character IDs may be entirely numeric, so unadorned values can look like arbitrary counts rather than decision references.

## Options considered

- Leave IDs unadorned
- Use color only
- Use code-like delimiters plus theme-aware TUI styling

## Consequences

Decision references remain recognizable without relying on color. Markdown renders IDs as inline code; plain-text surfaces retain visible backticks; interactive TUI rows use consistent delimiters and theme accent styling. Internal stored IDs and command input remain unchanged.

## Follow-ups

- Centralize ID formatting helpers and cover messages, receipts, details, exports, widgets, selectors, confirmations, completions, warnings, and documentation examples
- Keep machine-readable fields and raw command arguments unformatted

