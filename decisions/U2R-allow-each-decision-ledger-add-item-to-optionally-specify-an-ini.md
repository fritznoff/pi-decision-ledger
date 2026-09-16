---
id: "U2R"
lifecycle: "resolved"
title: "Allow each `decision_ledger add` item to optionally specify an initial lifecycle and complete record, with strict atomic validation."
---

# Allow each `decision_ledger add` item to optionally specify an initial lifecycle and complete record, with strict atomic validation.

- **Decision ID:** `U2R`
- **Lifecycle:** `resolved`

## Decision point

Allow each item in a `decision_ledger add` batch to optionally specify an initial lifecycle and complete record, so known proposed, resolved, deferred, or ignored decisions can be captured atomically without follow-up tool calls; exploring remains forbidden because it requires a conversation return bookmark.

## Decision / outcome

Allow each `decision_ledger add` item to optionally specify an initial lifecycle and complete record, with strict atomic validation.

## Context

Known proposals, completed outcomes, deferred decisions, and ignored decisions previously required one or more follow-up tool calls after creation even when the user had already supplied or accepted their state.

## Options considered

- Allow only open items on add
- Allow an optional proposal only
- Allow validated initial open, proposed, resolved, deferred, or ignored states

## Consequences

Omitted lifecycle defaults to open. Proposed, resolved, and ignored items require complete records; deferred records are optional; open items reject records. Exploring remains forbidden because it requires a live return bookmark. Multiple proposed items retain independent canonical Markdown drafts, and one invalid item rejects the entire batch before ID allocation or state publication.

## Follow-ups

- (none)

