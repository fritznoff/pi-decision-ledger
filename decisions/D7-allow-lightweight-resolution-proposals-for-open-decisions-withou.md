---
id: "D7"
lifecycle: "resolved"
title: "Allow lightweight resolution proposals for open decisions without requiring focused exploration."
---

# Allow lightweight resolution proposals for open decisions without requiring focused exploration.

- **Decision ID:** `D7`
- **Lifecycle:** `resolved`

## Decision point

Allow lightweight resolution proposals for open decisions without requiring a focused exploration or return bookmark.

## Decision / outcome

Allow lightweight resolution proposals for open decisions without requiring focused exploration.

## Context

A request such as “what do you propose for D3?” should produce a tracked proposal, but the current propose operation is coupled to the exploration lifecycle.

## Options considered

- Keep proposals restricted to focused explorations
- Allow proposals directly from open decisions

## Consequences

Open decisions can move to resolution_proposed without a bookmark. Accepted lightweight proposals resolve through an ordinary update; explored proposals continue to use /decision return.

## Follow-ups

- Implement proposal acceptance and rejection transitions for non-explored decisions

