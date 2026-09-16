---
id: "2RB"
lifecycle: "resolved"
title: "Show an immediate temporary theme-aware animated progress widget during `/decision return` processing."
---

# Show an immediate temporary theme-aware animated progress widget during `/decision return` processing.

- **Decision ID:** `2RB`
- **Lifecycle:** `resolved`

## Decision point

Provide visible progress immediately after confirming the reviewed decision while `/decision return` persists the draft and summarizes/navigates the exploration branch.

## Decision / outcome

Show an immediate temporary theme-aware animated progress widget during `/decision return` processing.

## Context

Pi’s native branch-summary status indicator is internal to the built-in tree handler. Extension APIs can customize an already-active working loader but cannot activate it for extension-driven `navigateTree` summarization, so the current return flow appears idle.

## Options considered

- Temporary animated widget
- Static status message
- Wait for a native Pi extension API

## Consequences

After the user accepts the reviewed Markdown, the extension immediately displays a spinner with a concise summarization/return message. It remains visible through draft persistence and branch summarization, then is disposed using the current active context on success, cancellation, error, shutdown, or reload. The implementation uses a dedicated widget key and Pi TUI components rather than stale timers or captured contexts.

## Follow-ups

- Add the progress widget to the follow-up implementation batch
- Test immediate rendering, animation disposal, navigation-induced context changes, cancellation, errors, shutdown, and reload
- Document that the exact native branch-summary indicator is not publicly available to extensions

