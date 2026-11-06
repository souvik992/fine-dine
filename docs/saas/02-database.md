# SaaS PostgreSQL data model

## Database boundary
This schema is for a dedicated SaaS PostgreSQL database. It is not an outlet SQLite migration and must never be run by the POS migration runner. Put future migrations under `packages/saas-db/migrations`.

## Core entities
- users: authentication identity.
- user_sessions: hashed opaque browser session tokens, expiry and revocation.
- user_auth_tokens: hashed, one-time email-verification and password-reset tokens.
- organizations: commercial customer.
- organization_business_profiles: legal/trade identity, business category, tax registrations and registered address.
- organization_members: organization roles.
- outlets: outlet registry, contact details, GST/FSSAI details and deployment mapping.
- plans + plan_entitlements: versionable commercial catalogue.
- subscriptions: organization-level billing period and state.
- provisioning_jobs: durable idempotent workflow.
- activation_challenges: short-lived one-time hardware activation.
- licences: issued signed key metadata; private key is never stored here.
- device_activations: outlet devices and seat use.
- payments + webhook_events + invoices: financial history.
- idempotency_records: replay-safe registration/provisioning/checkout/activation requests.
- audit_logs: append-only security/business trail.

## Migration history
- `0001_saas_core.sql`: tenant, subscription, provisioning, licence and billing baseline.
- `0002_auth_and_business_profile.sql`: sessions, one-time auth tokens, organization business profile, outlet contact/address/tax fields and generic idempotency records.

## Business profile rules
- Business profile is one-to-one with an organization; a customer may add multiple outlets under it.
- Capture registered legal name and trade/display name separately.
- Business type and industry are extensible text codes, not a restrictive enum, so restaurant, cafe, QSR, bakery, cloud kitchen, grocery, retail and future verticals can be supported.
- PAN, GSTIN, CIN and FSSAI licence are optional during demo signup. Validate formats when supplied; do not block a trial because the customer has not entered tax registrations.
- GSTIN and FSSAI can differ by outlet. Organization-level values describe the primary registered business; outlet-level values describe the individual branch.
- Store structured address fields for search and reporting. Do not put the entire address only in JSONB.
- Keep billing contact/address separate from operational outlet contact/address.
- Do not collect bank account details during demo registration.

## Authentication rules
- Passwords are stored only as modern password hashes (Argon2id recommended); never store plaintext or reversible passwords.
- Browser session tokens and verification/reset tokens are cryptographically random, shown only once and stored as SHA-256 digests.
- Email verification and password reset tokens are single-use, purpose-scoped and short-lived.
- Revoke sessions after password reset, account block or logout.
- Apply rate limits to login, registration, resend verification and password reset. Responses must not reveal whether an email address exists.
- Use Secure, HttpOnly, SameSite cookies and CSRF protection for browser mutations.

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

## Later migrations
- Subscription item/add-on allocation and organization-to-outlet entitlement allocation.
- Support tickets, downloadable release channels and software update rings.
- GST tax configuration / credit notes after accountant review.
