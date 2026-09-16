---
id: "FO3"
lifecycle: "resolved"
title: "Persist the reviewed decision draft on the exploration branch before summarization, then finalize the exact record on the destination branch only after successful navigation."
---

# Persist the reviewed decision draft on the exploration branch before summarization, then finalize the exact record on the destination branch only after successful navigation.

- **Decision ID:** `FO3`
- **Lifecycle:** `resolved`

## Decision point

Clarify and improve `/decision return` ordering so the reviewed decision record remains exact and the branch summary reflects the reviewed version without prematurely finalizing on the exploration branch.

## Decision / outcome

Persist the reviewed decision draft on the exploration branch before summarization, then finalize the exact record on the destination branch only after successful navigation.

## Context

The current implementation preserves the exact record by finalizing after navigation, so the document is not compressed. However, review-editor changes are held only in memory while the branch summary runs, meaning the summary may describe the pre-edit proposal.

## Options considered

- Persist the reviewed draft before summarization
- Keep the current ordering
- Pass the edited record only through summarizer instructions

## Consequences

The summarizer sees the reviewed version without treating it as finalized. Successful navigation writes the exact reviewed record as resolved on the destination branch. Cancellation or failure leaves the exploration branch proposed with the reviewed draft intact and does not produce a false resolution.

## Follow-ups

- Add a replayable reviewed-draft snapshot before navigation
- Test edited versus unchanged drafts, summary inputs, successful finalization, cancellation, rejection, and reload durability

