---
id: "RFM"
lifecycle: "resolved"
title: "Intercept autocomplete for ID-taking `/decision` arguments so forced Tab completion returns only matching decision IDs and suppresses file-path fallback."
---

# Intercept autocomplete for ID-taking `/decision` arguments so forced Tab completion returns only matching decision IDs and suppresses file-path fallback.

- **Decision ID:** `RFM`
- **Lifecycle:** `resolved`

## Decision point

Ensure Tab completion for `/decision explore` and other ID-taking decision commands offers only decision IDs and never falls back to filesystem path completion.

## Decision / outcome

Intercept autocomplete for ID-taking `/decision` arguments so forced Tab completion returns only matching decision IDs and suppresses file-path fallback.

## Context

Pi’s base autocomplete provider can bypass slash-command argument completions during forced Tab completion and then treat the empty argument after `/decision explore ` as a filesystem path prefix.

## Options considered

- Rely only on command argument completions
- Add an extension autocomplete-provider wrapper for decision-ID contexts
- Accept filesystem fallback

## Consequences

The extension wrapper recognizes explore and remove ID argument positions regardless of forced completion, supplies raw ID completion values with concise title descriptions, and reports that file completion should not trigger in those contexts. No-match cases remain empty rather than showing paths. Other commands and editor contexts delegate unchanged to Pi’s existing provider.

## Follow-ups

- Test forced and automatic completion, empty and partial IDs, multiple remove IDs, no matches, legacy IDs, cursor positions, reloads, and unaffected non-decision path completion

