---
id: "194"
lifecycle: "resolved"
title: "Reinforce focused exploration with durable transition messages and an ephemeral latest-context marker on every LLM call."
---

# Reinforce focused exploration with durable transition messages and an ephemeral latest-context marker on every LLM call.

- **Decision ID:** `194`
- **Lifecycle:** `resolved`

## Decision point

Make focused-decision transitions explicit and give the current decision recency precedence so ambiguous references resolve to the actively explored decision rather than a recently resolved one.

## Decision / outcome

Reinforce focused exploration with durable transition messages and an ephemeral latest-context marker on every LLM call.

## Context

`/decision explore` is handled as an extension command and does not itself enter normal conversational context. A recent return receipt about another decision can therefore outweigh the current system-prompt focus reminder when the user uses ambiguous language such as “this.”

## Options considered

- Durable transition messages plus a per-call marker
- Transition messages only
- Per-call marker only

## Consequences

Starting, switching, returning from, or exiting exploration appends a concise focus-transition custom message to session context. While focus is active, the context hook appends a hidden final marker naming the current ID, title, and point and instructing the model to resolve ambiguous references to it unless the current user message explicitly identifies another subject. Ledger state remains authoritative; historical markers cannot override the latest state. The existing system-prompt focus rule remains as policy-level reinforcement.

## Follow-ups

- Add custom message rendering and context-hook injection
- Test return-then-explore pronoun resolution, switching, exit, branch replay, compaction, tool-loop calls, and absence of stale markers when no focus is active

