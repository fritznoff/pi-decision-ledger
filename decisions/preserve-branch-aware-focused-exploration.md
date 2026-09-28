---
status: accepted
x-pi-decision-ledger:
  version: 1
  id: eb48511e-cff9-4c57-b814-96c5ec17a1aa
  semanticDigest: sha256:4c0086b7abd8d943342cdc63caa7febb80cc8f6e11b9815e993d02ca78234020
  supersedes: []
  supersededBy: []
---

# Branch-aware focused exploration

## Context and Problem Statement

Consolidate the durable focused-exploration and return protocol across branch navigation, context reinforcement, exact reviewed-draft persistence, and complementary handoff summarization.

Slash-command exploration and tree navigation are not automatically represented in ordinary conversation context. Without reinforcement, ambiguous references can drift to recently discussed decisions. Without persisting the reviewed draft before navigation, summarization can describe stale pre-review content; restating the complete record in the return summary then wastes the handoff channel.

## Considered Options

- Rely only on skill guidance and in-memory reviewed text
- Use strict message filtering and repeat the complete record during return
- Combine durable transitions, per-call soft focus, replayable reviewed drafts, and a complementary return handoff

## Decision Outcome

Implement focused exploration as reinforced soft focus over branch-local state. Record concise durable focus transitions, inject one latest hidden focus marker on every model call while focus is active, persist the exact reviewed proposal on the exploration branch before navigation summarization, finalize that exact record only after successful return, and make the generated return handoff contain only complementary evidence, risks, cross-decision effects, and immediate continuation context.

### Consequences

Focus resists accidental drift without blocking explicit user intent. Branch summaries see the reviewed proposal, cancellation and navigation failure preserve a proposed draft rather than falsely resolving it, and successful return writes exactly what the user reviewed. The handoff stays concise because the structured record remains authoritative for decision content.