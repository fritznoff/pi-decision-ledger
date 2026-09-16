---
id: "D10"
lifecycle: "resolved"
title: "Use concise, theme-aware success messaging throughout the decision ledger and reserve red exclusively for errors."
---

# Use concise, theme-aware success messaging throughout the decision ledger and reserve red exclusively for errors.

- **Decision ID:** `D10`
- **Lifecycle:** `resolved`

## Decision point

Standardize successful decision-ledger feedback: use `Decision <ID> resolved: <short outcome summary>`, render success states in a harmonious theme-provided green, show `Decisions: all resolved` when none remain, and reserve red for errors.

## Decision / outcome

Use concise, theme-aware success messaging throughout the decision ledger and reserve red exclusively for errors.

## Context

Resolution receipts and the zero-unresolved widget currently look like error states because they are red. Successful outcomes should be immediately recognizable, concise, and visually harmonious with the active Pi theme.

## Options considered

- Keep the existing wording and red styling
- Hard-code a pastel green
- Use Pi’s theme-provided success color with concise standardized wording

## Consequences

Final receipts read `Decision <ID> resolved: <short outcome summary>`. When no decisions remain unresolved, the widget reads `Decisions: all resolved`. Both use the theme’s `success` color, while red/error styling is used only for actual failures.

## Follow-ups

- Update return-receipt formatting
- Update the zero-unresolved widget text and styling
- Audit decision-ledger UI paths so error styling is limited to actual errors
- Add focused output and styling tests

