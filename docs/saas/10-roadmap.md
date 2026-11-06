# SaaS implementation roadmap

This roadmap is separate from the existing POS roadmap. Do not mark a task complete until code and tests exist.

## S0 — Discovery and architecture
- [ ] S0-01 Inspect existing root workspace, CI, TypeScript, lint and test conventions.
- [ ] S0-02 Inspect current licence verifier/keygen compatibility and golden test vectors.
- [ ] S0-03 Inspect cloud hub store/device/licence routes and define narrow service integration.
- [ ] S0-04 Verify hosted-outlet provisioning implementation status.
- [ ] S0-05 Review this architecture and record ADRs.

## S1 — SaaS database and API foundation
- [ ] S1-01 Add dedicated PostgreSQL migration runner/package; do not touch outlet SQLite migrations.
- [ ] S1-02 Apply 0001_saas_core.sql and add migration integrity tests.
- [ ] S1-03 Implement API configuration, health/readiness and request validation.
- [ ] S1-04 Implement authentication, sessions and email verification.
- [ ] S1-05 Implement organization membership and tenant-scoped repositories.
- [ ] S1-06 Add cross-tenant authorization tests.

## S2 — 14-day Windows trial
- [ ] S2-01 Add trial uniqueness and idempotent creation.
- [ ] S2-02 Implement provisioning job worker with leases/retries.
- [ ] S2-03 Add email delivery and installer download metadata.
- [ ] S2-04 Implement activation challenges and abuse controls.
- [ ] S2-05 Add customer provisioning status UI.

## S3 — Licence activation
- [ ] S3-01 Implement signer adapter compatible with existing v1 payload.
- [ ] S3-02 Add trusted SaaS-to-hub licence update adapter.
- [ ] S3-03 Implement hardware activation and seat enforcement.
- [ ] S3-04 Add renewal, replacement and offline compatibility tests.

## S4 — Customer portal
- [ ] S4-01 Dashboard and outlet management.
- [ ] S4-02 Licence and device management.
- [ ] S4-03 Downloads and release notes.
- [ ] S4-04 Team roles, billing profile and support entry point.

## S5 — Subscription payments
- [ ] S5-01 Plan catalogue and entitlement evaluator.
- [ ] S5-02 Razorpay order creation and raw-body webhook verification.
- [ ] S5-03 Idempotent payment state machine and reconciliation.
- [ ] S5-04 Subscription lifecycle and renewal jobs.
- [ ] S5-05 GST invoice snapshots and PDF generation (after accountant review).

## S6 — Hosted deployment and operations
- [ ] S6-01 Verify hosted outlet provisioning lifecycle and idempotency.
- [ ] S6-02 Add hosted outlet create/suspend/restore workflows.
- [ ] S6-03 Add admin operations, MFA and audit.
- [ ] S6-04 Add metrics, backups, restore drills and production rollout.

## Definition of done
Typecheck, lint, tests and relevant integration tests pass. Documentation and changelog updated. Existing POS and cloud hub tests remain green. No production secrets or resources are changed without approval.
