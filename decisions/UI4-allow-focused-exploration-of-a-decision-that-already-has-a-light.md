---
id: "UI4"
lifecycle: "resolved"
title: "Allow focused exploration of a decision that already has a lightweight proposal, carrying the proposal into the exploration for acceptance or revision."
---

# Allow focused exploration of a decision that already has a lightweight proposal, carrying the proposal into the exploration for acceptance or revision.

- **Decision ID:** `UI4`
- **Lifecycle:** `resolved`

## Decision point

Allow a decision with a lightweight proposal to enter focused exploration while preserving that proposal for review, acceptance, or modification.

## Decision / outcome

Allow focused exploration of a decision that already has a lightweight proposal, carrying the proposal into the exploration for acceptance or revision.

## Context

A proposal may prompt further questions rather than an immediate accept-or-reject choice. Blocking exploration prevents the user from gathering the evidence needed to evaluate or refine it.

## Options considered

- Require accepting or rejecting the lightweight proposal before exploration
- Discard the proposal when exploration starts
- Preserve the proposal and promote it into focused exploration

## Consequences

Starting exploration from resolution_proposed retains the record and Markdown draft, adds an exploration bookmark, and lets later propose calls revise it. `/decision return` reviews and finalizes the latest draft. Explicit exploration exit must return the item to its prior lightweight-proposal state rather than deleting the proposal.

## Follow-ups

- Add proposal-to-exploration transition support
- Preserve the proposal across exploration exit and branch replay
- Test unchanged acceptance, revised proposals, cancellation, switching, and return behavior

