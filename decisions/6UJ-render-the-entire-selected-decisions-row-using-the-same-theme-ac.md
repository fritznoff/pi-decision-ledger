---
id: "6UJ"
lifecycle: "resolved"
title: "Render the entire selected `/decisions` row using the same theme accent as the selection arrow."
---

# Render the entire selected `/decisions` row using the same theme accent as the selection arrow.

- **Decision ID:** `6UJ`
- **Lifecycle:** `resolved`

## Decision point

In `/decisions`, style the selected decision text with the same selection highlight as the arrow instead of a normal lifecycle/status color.

## Decision / outcome

Render the entire selected `/decisions` row using the same theme accent as the selection arrow.

## Context

Retaining lifecycle colors inside the selected row made it resemble an unresolved item and weakened the selection indicator.

## Options considered

- Highlight only the arrow
- Highlight the ID and label but retain semantic description styling
- Strip embedded row styling and apply one accent highlight to the complete selected row

## Consequences

The selected row has one clear visual state; unselected rows retain lifecycle and disposition styling.

## Follow-ups

- (none)

