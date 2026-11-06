# SaaS PostgreSQL data model

## Database boundary
This schema is for a dedicated SaaS PostgreSQL database. It is not an outlet SQLite migration and must never be run by the POS migration runner. Put future migrations under `packages/saas-db/migrations` or the selected SaaS DB package.

## Core entities
- users: authentication identity.
- organizations: commercial customer.
- organization_members: organization roles.
- outlets: outlet registry and deployment mapping.
- plans + plan_entitlements: versionable commercial catalogue.
- subscriptions: organization-level billing period and state.
- provisioning_jobs: durable idempotent workflow.
- activation_challenges: short-lived one-time hardware activation.
- licences: issued signed key metadata; private key is never stored here.
- device_activations: outlet devices and seat use.
- payments + webhook_events + invoices: financial history.
- audit_logs: append-only security/business trail.

## Migration 0001
See `0001_saas_core.sql`. It creates the first production-oriented baseline, including tenant relationships, constraints and indexes.

## Important modelling rules
1. Organization owns subscription; outlets are covered by entitlements. Do not make every outlet create its own subscription in MVP.
2. Outlet operational data is not in this database.
3. Email is stored normalized (trimmed/lowercase) and unique.
4. Use `timestamptz` in UTC.
5. Money is integer minor units (paise) plus ISO currency; never float.
6. Trial dates are explicit and immutable once trial starts, except audited admin extension.
7. Gateway event IDs and idempotency keys are unique.
8. Payment/invoice/licence/audit history is retained according to retention policy; no destructive cascade from organization deletion.
9. JSONB is for snapshots/provider payloads, not primary relationships or entitlement enforcement.
10. Store password hashes only; never passwords, OTP plaintext, activation token plaintext or signed private material.

## Plan entitlements
Use stable feature codes such as `outlets.max`, `devices.terminals.max`, `devices.captains.max`, `devices.kds.max`, `features.inventory`, `deployment.hosted`. Quantity entitlements have integer values. Feature evaluation must be centralized in a typed entitlement service.

## Next migrations (not included in 0001)
- 0002: email/phone verification challenges and refresh sessions if selected auth design needs separate tables.
- 0003: subscription item/add-on allocation and organization-to-outlet entitlement allocation.
- 0004: support tickets, downloadable release channels and software update rings.
- 0005: GST tax configuration / credit notes after accountant review.
