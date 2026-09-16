---
id: "ZM2"
lifecycle: "resolved"
title: "Use `/decision return` summarization as a complementary exploration handoff rather than a restatement of the structured decision record."
---

# Use `/decision return` summarization as a complementary exploration handoff rather than a restatement of the structured decision record.

- **Decision ID:** `ZM2`
- **Lifecycle:** `resolved`

## Decision point

Refine `/decision return` summarization so it complements the structured decision record instead of repeating its decision, context, options, consequences, and follow-ups.

## Decision / outcome

Use `/decision return` summarization as a complementary exploration handoff rather than a restatement of the structured decision record.

## Context

The existing summary prompt duplicates the record’s decision, context, options, consequences, and follow-ups. The summary slot is more useful for context that does not fit those fields but matters after returning.

## Options considered

- Use a complementary handoff
- Keep the current overlapping summary
- Use no generated summary

## Consequences

The return summary omits record-field repetition and captures only concrete evidence or references not represented in the record, unresolved caveats or risks, effects on other decisions or work, and immediate context needed to continue. If nothing additional exists, it says so briefly. It remains focused, bounded, excludes unrelated work, and never claims filesystem changes were reverted.

## Follow-ups

- Replace the current custom navigation prompt
- Test overlap avoidance, empty-extra-context output, cross-decision effects, evidence references, and interaction with the persisted reviewed draft

