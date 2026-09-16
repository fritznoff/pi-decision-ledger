---
id: "C6L"
lifecycle: "resolved"
title: "Complete the `re` prefix to `/decision return` before offering `/decision remove`."
---

# Complete the `re` prefix to `/decision return` before offering `/decision remove`.

- **Decision ID:** `C6L`
- **Lifecycle:** `resolved`

## Decision point

Rank `/decision return` ahead of `/decision remove` when completing the shared `re` prefix, while preserving ID-only completion for ID-taking subcommands.

## Decision / outcome

Complete the `re` prefix to `/decision return` before offering `/decision remove`.

## Context

Both return and remove share the same prefix, but return is the common non-destructive action during focused exploration and should be the first Tab-completion candidate.

## Options considered

- Keep registration order with remove first
- Rank return before remove for the shared prefix
- Require more characters before completing

## Consequences

The autocomplete wrapper handles both subcommand and ID completion. For `re`, return is ranked first and remove second. Once remove or explore enters an ID argument position, only decision IDs are offered and filesystem completion remains suppressed.

## Follow-ups

- Test repeated Tab cycling, exact and partial subcommands, ranking stability, remove-ID completion, and unrelated command completion

