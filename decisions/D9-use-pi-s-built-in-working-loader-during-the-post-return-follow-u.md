---
id: "D9"
lifecycle: "resolved"
title: "Use Pi’s built-in working loader during the post-return follow-up turn instead of implementing a custom spinner."
---

# Use Pi’s built-in working loader during the post-return follow-up turn instead of implementing a custom spinner.

- **Decision ID:** `D9`
- **Lifecycle:** `resolved`

## Decision point

Show a native Pi working indicator while `/decision return` is completing, using the built-in loader when a follow-up model turn is active rather than implementing a custom spinner.

## Decision / outcome

Use Pi’s built-in working loader during the post-return follow-up turn instead of implementing a custom spinner.

## Context

After `/decision return`, conversation navigation and follow-up processing can otherwise appear idle. Pi already provides a theme-compatible working row through its extension UI API.

## Options considered

- Show no progress indicator
- Build and manage a custom spinner
- Use Pi’s native working loader

## Consequences

The return flow uses `setWorkingMessage` with Pi’s default working indicator while the follow-up response is active, then restores the defaults. A transient status is used only when no streaming turn occurs.

## Follow-ups

- Integrate the native loader into the return handoff
- Verify cleanup after success, cancellation, and errors

