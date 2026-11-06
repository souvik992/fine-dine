# SaaS security and privacy baseline

## Identity
- Argon2id password hashing (or maintained equivalent); unique normalized email.
- Email verification before trial provisioning.
- Secure HttpOnly SameSite cookies where practical, CSRF defence for cookie mutations, session rotation and logout revocation.
- MFA mandatory for super-admin; recommend MFA for organization owners.
- Rate-limit login, OTP, reset, trial, activation and checkout endpoints.

## Tenant isolation
- Every organization-scoped repository requires authenticated actor + organization membership.
- Role authorization: owner, admin, manager, billing. Billing role cannot manage devices or users by default.
- Never trust organization ID from request body as authorization.
- Add tests attempting cross-tenant reads/writes for every resource family.
- Consider PostgreSQL row-level security as defence-in-depth, not replacement for application checks.

## Secrets and signing
- Secrets only in managed secret store / deployment environment; never committed.
- Ed25519 private key isolated from application DB and browser.
- Hub admin credential server-side only; prefer narrow service credential with least privilege.
- Rotate gateway/email/database secrets and document incident response.
- Redact passwords, tokens, activation codes, licence contents, GST and payment details from logs.

## Payment integrity
- Verify Razorpay webhook signatures over raw body.
- Deduplicate event IDs and enforce amount/currency/order consistency.
- Do not activate from browser callback.
- Audit refunds and manual entitlement overrides.

## Data protection
- TLS in transit; encryption at rest for managed database and backups.
- Data minimization, retention schedule, export/deletion process and privacy notice.
- Never cascade-delete immutable payment, invoice, licence or audit history.
- Backups encrypted; regularly test restore.
- Restrict support staff access and audit customer impersonation.

## Operational controls
- Admin MFA, least privilege, audit every privileged change.
- Dependency scanning, secret scanning, patch cadence.
- Security headers, CORS allowlist, CSRF protection, request size limits.
- Incident runbook for signing key compromise, payment webhook compromise, tenant data exposure and hub credential compromise.
