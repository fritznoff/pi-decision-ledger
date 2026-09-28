---
status: accepted
x-pi-decision-ledger:
  version: 1
  id: c60000a8-d472-4369-a712-a00b15fc93fe
  semanticDigest: sha256:afbd619f6e8840ebad9bf0dfbdd46fd42aa4ae1b995684a45cd3bd04c7489b6e
  supersedes: []
  supersededBy: []
---

# Promote significant session decisions into authoritative repository ADRs

## Context and Problem Statement

Session decisions are useful while a conversation is active, but session state is not a reliable shared authority across conversations, collaborators, Git history, or downstream implementation work. Persisting every conversational choice would create noise, while writing files without a clear authority boundary could leave the session and repository with competing versions of the same decision.

The promotion workflow therefore needs to select only durable decisions, let semantic judgment shape coherent ADRs, give the user control over the exact published artifact, and protect repository drafts from lost updates. Promotion, acceptance, and implementation must remain separate events.

## Considered Options

- Keep session state authoritative and export decision records only as secondary documentation.
- Automatically export every resolved session decision as an ADR.
- Let the extension classify, group, and rewrite decisions automatically before publication.
- Explicitly promote selected significant decisions through a reviewed repository-backed draft lifecycle.
- Require repository governance or pull-request approval as part of ADR acceptance.

## Decision Outcome

Use explicit, selective promotion into repository-backed ADRs.

The skill recommends promotion when a decision has lasting architectural, operational, product-contract, security, reliability, data-handling, or governance significance; affects multiple components or people; is costly to reverse; or preserves rationale future maintainers will need. Routine implementation details, temporary debugging choices, easily reversible local preferences, and superseded exploration remain session-local. The user always makes the final promotion choice.

The skill also decides whether selected source decisions form one ADR or several and synthesizes each candidate into one coherent decision narrative. The extension performs only deterministic mechanics for the explicit ordered source set and never infers semantic grouping.

Before the first repository write, the user edits and approves the exact envelope-free ADR Markdown. The reviewed text is used directly for validation, digesting, and publication without regeneration. Cancellation or validation failure writes nothing, assigns no durable identity, and transfers no authority.

Successful promotion creates an authoritative repository ADR with a permanent UUID and `proposed` MADR status. The repository file becomes the source of truth; session state retains only a provenance-bearing working copy. Proposed ADRs remain editable, but publishing requires the authoritative file to match the checkout bytes exactly. Any difference stops the write and requires explicit reload and reconciliation rather than overwrite or automatic merge.

Acceptance is a separate explicit transition from `proposed` to `accepted`. It rereads and verifies the authoritative ADR, then changes only its status. Acceptance freezes recognized semantic content; later substantive changes require a traceable successor. The extension does not model reviewer roles, pull-request policy, or other repository governance.

### Consequences

- Good, because durable decisions gain a single repository authority that survives sessions and participates naturally in Git workflows.
- Good, because selective promotion keeps the ADR collection useful instead of mirroring every conversational choice.
- Good, because skill-driven synthesis produces coherent ADRs while deterministic extension mechanics preserve provenance and avoid hidden grouping heuristics.
- Good, because exact editable review prevents transient, sensitive, speculative, or irrelevant session material from being published unintentionally.
- Good, because strict byte-level conflict detection prevents silent loss of comments, formatting, opaque metadata, or collaborators' edits.
- Good, because promotion, acceptance, and implementation remain distinct and understandable lifecycle events.
- Bad, because promotion requires deliberate review and therefore costs more effort than automatic export.
- Bad, because any external byte change blocks publishing until the user explicitly reloads and reconciles it, even when the change is semantically harmless.
- Bad, because teams that need approval policy or governance must continue to enforce it through Git hosting, pull requests, or other external processes.