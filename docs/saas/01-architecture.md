# Fine Dine SaaS architecture

## Repository reality and constraints
The root README describes this repository as a spec + scaffold. The existing POS is Node 22 / TypeScript / Electron / Fastify / better-sqlite3. The separate `cloud/hub` package is Node 24 + `node:sqlite`, zero runtime dependencies. Do not assume the hub is a Fastify app or replace its persistence layer.

Existing outlet licence contract is documented in `docs/07-security-licensing.md`: base64url(payload JSON) + "." + base64url(Ed25519 signature); payload v1 includes `licensee`, `hardwareId`, `issuedAt`, `expiresAt`, `seats` and `features`. Existing POS fetches renewed keys from the hub's `GET /v1/pos/licence` flow hourly and verifies locally.

## Logical components
1. Public website + customer portal (React/Vite).
2. SaaS API (Fastify + TypeScript; PostgreSQL).
3. SaaS worker (provisioning, email, renewal reminders, invoice jobs).
4. SaaS database (PostgreSQL, isolated from POS operational databases).
5. Existing cloud hub (Node 24 + node:sqlite), reached only through an internal adapter.
6. Existing outlet runtime (SQLite, LAN clients, offline operations).
7. Hosted outlet runtime (one isolated operational database per hosted outlet).

## Trust boundaries
Browser -> SaaS API: customer session; never trusted for organization membership or payment status.
SaaS API -> PostgreSQL: tenant-scoped repositories and transactions.
SaaS API/worker -> hub: authenticated server-to-server calls; never expose HUB_ADMIN_KEY to browser.
SaaS licence issuer -> POS: Ed25519 signed v1 licence; private key only in managed secret storage.
POS -> hub: existing paired device credential and current renewal contract.

## Suggested source layout
```
apps/saas-api/
apps/saas-web/
apps/saas-admin/
apps/saas-worker/
packages/saas-contracts/
packages/saas-db/
packages/licensing/
docs/saas/
```
Add these as npm workspaces only after reviewing root tsconfig, eslint, Vitest and workspace conventions. The SaaS API may be a Fastify service, but the existing hub stays Node 24 as-is.

## Data ownership
PostgreSQL stores SaaS users, organizations, memberships, outlet registry, plan catalog, subscriptions, entitlements, activation challenges, licence metadata, payment/webhook/invoice records and audit events.
Outlet SQLite remains authoritative for orders, bills, KOTs, inventory, staff PINs, printer jobs and day state.
Hosted operational databases remain isolated per outlet.

## Integration strategy
- Implement a hub adapter interface in SaaS API/worker.
- Initial adapter can use documented hub admin/store APIs only after verifying exact routes and semantics in source.
- Prefer a narrow internal endpoint for setting/renewing a store licence rather than reusing browser admin routes.
- Hub stores signed licence and serves it through the existing POS renewal route.
- Do not make the SaaS PostgreSQL database and hub SQLite database dual-writers for the same hub store data.

## Reliability
- Provisioning and webhook handlers are idempotent.
- Use outbox/job records in PostgreSQL; workers lease jobs and retry with bounded exponential backoff.
- Record attempts and sanitized errors.
- POS remains operational when SaaS API, PostgreSQL, email or hub is unavailable.
- Never delete/recreate an existing hub store on a retry.

## Decisions to resolve during implementation
- Existing repo's exact root branch/workspace conventions.
- Hub's internal licence-write operation and authentication contract.
- Whether hosted outlet lifecycle is implemented or only planned; inspect code before enabling cloud-hosted sales.
- Email provider, hosting region, backup RPO/RTO and data retention.
