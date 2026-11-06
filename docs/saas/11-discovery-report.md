# S0 discovery report — repository audit

**Audited ref:** `feature/saas-foundation`  
**Audit date:** 2026-11-07  
**Scope:** repository structure, POS licence implementation, cloud hub APIs, hosted outlet implementation, CI/workspace conventions.  
**Important:** this is a source-level discovery, not a local install/build/test run. No code was executed and no live cloud resources or secrets were accessed.

## Executive summary

The repository already contains considerably more working POS/cloud functionality than the root README's broad "spec + scaffold" warning suggests. In particular:
- The outlet POS has an implemented Ed25519 v1 licence verifier, stable Windows hardware ID, licence gate, device-seat enforcement, manual key installation and automatic renewal command.
- The cloud hub already supports store creation, POS pairing, vendor-set licence keys, POS licence polling, sales sync, backups, relay/tunnel and hosted outlets.
- Hosted outlet lifecycle is implemented in `cloud/hub/src/hosted.ts`, with one outlet server process and data directory per hosted store, and is covered by `cloud/hub/test/hosted.test.ts`.
- The repository is an npm workspaces monorepo, but root TypeScript project references are explicit. Adding SaaS workspace packages requires updating those references and CI/test configuration deliberately.
- The existing hub's admin API is authenticated only by the global `X-Admin-Key` (`HUB_ADMIN_KEY`). It is not an appropriate public browser integration and should not be exposed to the SaaS frontend.

**Recommendation:** implement SaaS as a new control plane and database, and integrate to the hub through a narrow, authenticated server-to-server adapter. Keep all existing POS and hub contracts backward compatible.

## S0-01 — workspace, TypeScript, tests and CI

### Observed
- Root package is private npm workspaces: `packages/*`, `apps/*`, `addons/*`.
- Root scripts: `typecheck` (`tsc -b`), `lint` (ESLint), `test` (Vitest), `check` and `test:cloud`.
- Root `tsconfig.json` explicitly references each current project. New SaaS TypeScript projects must be added here; workspace glob inclusion alone is insufficient for `tsc -b`.
- Shared compiler settings are strict NodeNext/ESM, target ES2022, Node 22 baseline.
- Root Vitest config has an explicit include list for packages/apps/addons; SaaS tests need adding or a deliberate separate test config.
- CI runs npm ci, typecheck, lint and test on Windows and Ubuntu; installer job runs on Windows.
- Cloud hub is separately tested with Node's built-in test runner through `npm run test:cloud`; `cloud/hub/package.json` requires Node >=24 and has no runtime dependencies.
- `CLAUDE.md` requires a plan before edits, tests, docs and changelog updates. Existing POS roadmap uses P1/P2/P3/P4/P6 task IDs; SaaS roadmap should remain separate.

### Decision
Add SaaS projects in the existing workspace only after selecting package names, dependency policy and build/test boundaries. Add explicit root TypeScript references, Vitest inclusion or separate SaaS test script, ESLint coverage and CI steps. Do not import SaaS dependencies into POS or cloud hub packages.

## S0-02 — licence and hardware compatibility

### Observed
- Verifier: `apps/server/src/licence/licence.ts`.
- Payload type is v1 and requires `v: 1`, `licensee`, `hardwareId`, `issuedAt`, `expiresAt`, `seats: { terminals, captains, kds }`, and `features: string[]`; optional `outletId`.
- Key format is `base64url(JSON payload).base64url(Ed25519 signature)`.
- Public key is read by `apps/server/src/licence/public-key.ts` / `from-env.ts`; private key is not part of POS runtime.
- Windows hardware ID is SHA-256-derived from MachineGuid and system drive volume serial, formatted as five groups of four uppercase hex digits (`apps/server/src/licence/hardware.ts`). Hosted hardware ID additionally incorporates the hosted outlet ID.
- Licence status warns 15 days before expiry, grants 7 days of grace, and blocks opening a new business date after grace. Existing day is not interrupted. Licence is enforced at pairing/seat use.
- `GET /v1/licence` reports local status and seat usage; this is not the cloud renewal endpoint.
- `RenewLicence` is an internal command. It verifies signature and local hardware ID, and refuses a key whose expiry is not later than the installed key.
- Existing tests generate Ed25519 keys and exercise signature, hardware mismatch, tampering, expiry/grace and install behaviour.

### Decision
Preserve v1 payload and current hardware-ID algorithm for MVP. Add golden compatibility tests that use the existing verifier implementation. Do not rotate keys until a versioned multi-public-key verifier exists. Do not issue a licence directly from the browser. Never interrupt a business day.

## S0-03 — cloud hub and licence renewal API

### Observed
- Hub is a standalone Node 24 + `node:sqlite` service (`cloud/hub`), intentionally separate from outlet SQLite and SaaS.
- Admin routes in `cloud/hub/src/http.ts` include:
  - `POST /v1/admin/stores`
  - `GET /v1/admin/stores/:slug`
  - `GET /v1/admin/stores/:slug/licence`
  - `PUT /v1/admin/stores/:slug/licence`
- These admin routes require `X-Admin-Key` via the hub's admin authentication function. Hub store creation returns a pairing code and connect URL.
- The licence write operation is `hub.sync.setLicence(storeId, key)`; it validates key shape but deliberately does not verify signature. The POS verifier remains authoritative.
- POS renewal route is `GET /v1/pos/licence` and requires a paired POS device credential. It returns the stored key and update timestamp.
- `apps/server/src/sync/sync-agent.ts` polls licence on startup, when the online link is created and every 3,600,000 ms (one hour). The renewal command installs only a valid key for that machine that expires later.
- Sales sync and licence renewals are documented as optional to billing; POS continues to bill while hub is unavailable.
- There is currently no separate SaaS service credential or narrow licence-management credential in the observed route contract. The global admin key grants broader hub administration.

### Decision
Do not call hub admin APIs from browser code. Do not distribute `HUB_ADMIN_KEY` to customers. Add a narrow internal service adapter/credential or a private network boundary for SaaS-to-hub calls. Keep current POS-facing `GET /v1/pos/licence` unchanged. Make store creation idempotent before using it in retryable provisioning; inspect `Hub.createStore` and add a stable external reference/lookup contract rather than assuming repeated POST is safe.

## S0-04 — hosted outlet lifecycle

### Observed
- Hosted mode is implemented, not merely planned.
- `cloud/hub/src/hosted.ts` maintains `hosted_outlet` records in hub SQLite, assigns a unique local port, generates a per-outlet host key, creates a separate data directory and starts one outlet server process per hosted store.
- Outlet process listens on loopback, runs with `DINEPOS_TRUST_LOOPBACK=0`, receives `DINEPOS_HOSTED_OUTLET` and its per-outlet `DINEPOS_HOST_KEY`; hub proxy strips host-key headers from outside requests.
- Hub starts enabled hosted outlets at boot, supports enable/disable, and restarts crashed outlet processes.
- Hosted integration test exists; it may skip when a suitable server bundle is unavailable.
- ADR-0005 says hosted mode needs internet at the outlet and is not offline-first. Relay mode keeps the outlet PC and local database and supports LAN billing without internet.
- Hosted hardware ID incorporates outlet ID, so each hosted outlet has its own licence identity.

### Decision
Keep deployment types explicit:
- `on_premise`: outlet master PC + local SQLite; cloud optional; offline billing supported.
- `hosted`: isolated hosted outlet process/database; internet required; no promise of offline billing.
The Windows demo download MVP should default to `on_premise`. Hosted trial provisioning can be a later self-service option once the SaaS-to-hub adapter safely provisions, enables, monitors and suspends hosted outlets.

## S0-05 — conflicts/gaps in initial SaaS draft

1. **Workspace integration:** initial docs proposed paths but did not mention explicit TypeScript references and current test includes; now addressed in this report.
2. **Licence polling interval:** current implementation is one hour, not merely a generic renewal interval. Keep it configurable only if a real product need exists.
3. **Hub auth:** existing admin key is broad. SaaS needs a restricted service boundary, not a browser call to admin routes.
4. **Store creation idempotency:** the current create-store API returns pairing code; verify duplicate behaviour and add external SaaS outlet reference before worker retries.
5. **Hosted provisioning:** implemented in hub but not yet wired to a SaaS commercial lifecycle. Enabling/disabling a hosted process is not by itself full tenant provisioning, billing enforcement or customer onboarding.
6. **Trial seats:** the trial's "master + one terminal" maps to two terminal seats because the master is counted as one terminal by `seatsUsed()`. Store entitlements and licence seats must use the same convention.
7. **Trial start:** start the 14-day period only after all required resources are ready and activation can proceed; record provisioning readiness and trial start atomically.
8. **Licence revocation:** a disconnected outlet cannot learn about immediate revocation. Keep the current offline grace semantics and describe revocation as taking effect on next successful renewal/check.
9. **SaaS migration:** initial SQL is a baseline draft. Review PostgreSQL version/managed-service permissions, auth/session tables, verification challenges, idempotency records, refunds and subscription lifecycle before production.
10. **No runtime validation:** this source audit did not run npm install, tests, typecheck, lint or migrations. S0 is discovery only.

## Recommended implementation order

1. S1: Add isolated SaaS workspace skeleton and PostgreSQL migration/test harness; do not touch outlet SQLite migrations.
2. S1: Implement auth, email verification, sessions, organization membership and tenant authorization.
3. S2: Implement 14-day on-prem Windows trial and durable idempotent job queue; initially provision SaaS records only, with no destructive hub mutation.
4. S3: Add narrow hub service adapter and external outlet reference; implement safe store create/lookup/update.
5. S3: Add activation challenge and v1 signer adapter, preserving existing verifier and hardware ID.
6. S4: Customer portal and downloads.
7. S5: Razorpay checkout, webhook reconciliation, subscriptions and invoice snapshots.
8. S6: Hosted deployment lifecycle and super-admin.

## Approval gates before S1/S2
- Choose authentication delivery: email magic link/OTP or password + email verification; recommended password + email verification and reset link.
- Choose email provider and production hosting region.
- Confirm trial policy: one trial per verified organization, and whether one phone number may create multiple organizations.
- Confirm whether Windows demo installer is an existing stable release artifact or must be built/published by CI.
- Confirm hosted deployment should be offered at launch or deferred until after on-premise subscriptions are stable.
