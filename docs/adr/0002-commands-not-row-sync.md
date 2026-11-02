# ADR-0002: Clients send commands, not row changes

- Status: accepted
- Date: 2026-11-02

## Context
Row-level sync from many devices needs conflict resolution per column and makes audit trails hard.

## Decision
Clients send intent commands (`FireKOT`, `MoveTable`…) with `commandId` and `expectedVersion`. The server
validates, applies, audits and broadcasts. Optimistic concurrency per order.

## Consequences
- Every change is audited with who/what/why for free.
- Each command needs a handler + tests (use `/add-command`).
- Version conflicts must be handled in client UX (silent rebase for safe commands, ask for risky ones).
