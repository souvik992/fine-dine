# Phase 4 prompts — controls, KDS, reports, cloud

## P4-01
Implement P4-01: audit viewer (filters by date, user, entity, leakage only) and the leakage dashboard in
docs/09-ui-screens.md, including the computed "fired but never billed" check.

## P4-02
Implement P4-02: apps/kds PWA per its README, bump commands, and a kitchen-speed report (fire → ready per
station and hour).

## P4-03
Implement P4-03: reports listed in docs/10-roadmap.md as GET /v1/reports/:name with CSV export and a
Reports screen. Each report gets a test on a seeded day of data.

## P4-04
Implement P4-04: reservations and waitlist that mark tables reserved/blocked on the floor and free them on settle.

## P4-05
Implement P4-05: cloud sync agent per docs/05-sync-offline.md (outbox up by seq, signed batches, resume;
menu documents and licence renewals down). Stub the cloud with a tiny local Fastify app for tests.

## P4-06
Implement P4-06: online orders relay — cloud receives an order from our own website, master creates an
`online` order awaiting accept, accept/reject from desktop, status updates back through the outbox.
