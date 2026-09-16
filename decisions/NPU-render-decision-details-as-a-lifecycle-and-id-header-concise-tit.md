---
id: "NPU"
lifecycle: "resolved"
title: "Render decision details as a lifecycle-and-ID header, concise title, then the complete decision document body without duplicate wrapper metadata."
---

# Render decision details as a lifecycle-and-ID header, concise title, then the complete decision document body without duplicate wrapper metadata.

- **Decision ID:** `NPU`
- **Lifecycle:** `resolved`

## Decision point

Simplify the `/decisions` detail view to show lifecycle state in the header, the concise decision title beneath it, and the complete decision document without redundant wrapper headings or repeated metadata.

## Decision / outcome

Render decision details as a lifecycle-and-ID header, concise title, then the complete decision document body without duplicate wrapper metadata.

## Context

The current modal repeats the ID, lifecycle, full point, record heading, and point across both its outer frame and nested Markdown.

## Options considered

- Keep the current nested detail formatting
- Show only the record document
- Use a compact header and title followed by the complete document body

## Consequences

The detail header contains the lifecycle symbol/state and visually distinct ID. The next line is the concise title. The body contains the full decision point and all available record sections exactly once. Decisions without records show their full point plus a concise no-record message. Return labels and other internal navigation metadata are omitted from the normal detail view.

## Follow-ups

- Create a reusable record-body renderer separate from standalone export headings
- Test all lifecycles, legacy title fallback, proposed and no-record states, long content, and terminal-width rendering

