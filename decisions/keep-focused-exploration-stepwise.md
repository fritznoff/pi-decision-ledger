---
status: accepted
x-pi-decision-ledger:
  version: 1
  id: 73ce849b-a756-451c-89ef-3e2baf752b04
  semanticDigest: sha256:f2393346b0a4d6cdf4eb119d07e80475820a3611fe4c432d6973b1f5c55fd37c
  supersedes: []
  supersededBy: []
---

# Keep focused exploration stepwise

## Context and Problem Statement

Focused exploration already keeps the agent on one decision, but topical focus alone does not prevent a response from combining several lines of reasoning. When the agent runs ahead in one turn, the user cannot easily inspect, redirect, or stop the exploration step by step.

## Considered Options

- Keep only the existing topical focus reminder
- Require each exploration response to advance one main thought in simple, linear language, with a concrete scenario or example when useful
- Enforce a rigid response template or one-sentence limit

## Decision Outcome

While focused exploration is active, every user-visible agent response advances exactly one main thought about the active decision. The agent explains that thought in a short, linear sequence using plain language, grounds it in a concrete scenario or example when that improves understanding, and then stops so the user can respond. Separate issues, conclusions, and next steps wait for later turns.

Reinforce this rule on every active exploration call through both the system prompt and the hidden focus marker. Explicit requests to switch focus, exit exploration, or discuss another subject remain valid.

### Consequences

Exploration becomes easier to follow, interrupt, and redirect before reasoning runs away. Complex analysis may require more turns, but each turn has a clear purpose. The rule remains flexible enough to explain one thought fully and does not impose a fixed template or one-sentence limit.