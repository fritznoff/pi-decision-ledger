---
id: "D6"
lifecycle: "resolved"
title: "Use reinforced soft focus during decision exploration."
---

# Use reinforced soft focus during decision exploration.

- **Decision ID:** `D6`
- **Lifecycle:** `resolved`

## Decision point

While a decision is being explored, constrain the agent’s conversation to that focused decision unless the user explicitly asks to discuss another ledger item or leave exploration mode.

## Decision / outcome

Use reinforced soft focus during decision exploration.

## Context

Focused exploration should resist accidental topic drift without blocking legitimate user intent. Skill-only guidance is easy to overlook, while strict extension-side filtering requires brittle natural-language classification and can obstruct normal conversation.

## Options considered

- Skill guidance only
- Reinforced soft focus through per-turn context injection
- Strict extension-side blocking

## Consequences

While exploration is active, each agent turn receives a concise reminder naming the focused decision and requiring the response to stay on it. The agent may discuss another item or leave focus when the user explicitly asks. The extension does not parse or reject ordinary user messages.

## Follow-ups

- Inject the active decision and focus rule into each agent turn while exploration is active
- Update the bundled skill to define explicit switching and exit behavior
- Add tests showing reminders persist across turns and stop after return

