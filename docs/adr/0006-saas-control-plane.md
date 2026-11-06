# ADR-0006: SaaS control plane for Fine Dine

**Status:** proposed after S0 source discovery (2026-11-07).  
**Scope:** customer identity, trial provisioning, subscription billing, licence administration and customer/admin portals.

## Context
DinePOS already has a separate Node 24 cloud hub that manages stores, pairing, sales sync, licence renewal, backups, relay and hosted outlet processes. The outlet server has its own SQLite operational database and Ed25519 licence verifier. The repository is an npm workspace monorepo with Node 22 as the root baseline and explicit TypeScript project references.

A commercial SaaS system is needed for self-service registration, 14-day Windows demo, customer portal, subscriptions and payment administration.

## Proposed decision
1. Add a separate SaaS control plane with its own PostgreSQL database.
2. Keep outlet operational data in each existing SQLite database.
3. Keep the existing cloud hub and its SQLite database as a distinct service.
4. SaaS communicates with hub through a narrow server-to-server adapter; never expose the hub admin key to browsers or customers.
5. Preserve POS licence v1 payload, signature verification, hardware ID, local expiry/grace and renewal flow.
6. Default demo deployment to on-premise Windows download. Hosted deployment is a distinct mode and requires internet; make hosted self-service available only after its commercial lifecycle integration is complete.
7. Monthly/yearly subscription billing in INR; Razorpay integration only after verified webhooks and reconciliation are implemented.
8. SaaS projects must be added to existing workspace, explicit TypeScript references, lint, test and CI configuration without importing SaaS code into POS runtime.

## Consequences
- A new database and deployment must be operated and backed up independently.
- Tenant authorization, authentication and payment integrity become SaaS responsibilities.
- Hub integration requires a restricted service credential or private network contract; the existing global admin key is too powerful for routine SaaS calls.
- Existing POS offline operation remains independent of SaaS uptime.
- Hosted mode can be sold later without conflating it with offline-capable on-premise deployments.

## Revisit when
- Authentication and email provider are selected.
- Hub internal service authentication contract is implemented.
- Hosted outlet subscription suspension/restore behaviour is specified.
