# SaaS API foundation implementation

The first runnable API service lives in `cloud/saas`, separate from `apps/server` and `cloud/hub`.

## Local startup
1. Install Node.js 22+ and PostgreSQL 14+.
2. Create a dedicated database (for example `finedine_saas`).
3. Copy `cloud/saas/.env.example` to `cloud/saas/.env` and set `DATABASE_URL`.
4. From `cloud/saas`, run `npm install`, `npm run migrate`, then `npm run dev`.
5. In development, verification/reset links are written to the API logger. Configure SMTP to test actual email delivery.

## Implemented
- PostgreSQL pool and independent migration runner with an advisory lock.
- Registration transaction: user, organization, owner membership, business profile, first on-premise outlet, provisioning job, terms audit record and verification token.
- Registration requires an `Idempotency-Key`; identical retries replay the same response and key reuse with a different body returns 409.
- Password hashing with Node scrypt and per-password salt.
- Single-use hashed email verification and password-reset tokens.
- Login, logout and opaque hashed database-backed sessions in HttpOnly cookies.
- Forgot/reset password; reset revokes all active sessions.
- Account summary and owner/admin business profile update endpoint.
- SMTP adapter plus local-development logger adapter.
- CORS allowlist, origin check and per-route rate limits.
- Unit tests for password hashing, token handling and cookie helpers.

## Routes
| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| POST | `/api/v1/auth/register` | Create owner/business/outlet and queue trial provisioning |
| POST | `/api/v1/auth/verify-email` | Consume verification token |
| POST | `/api/v1/auth/resend-verification` | Resend verification link |
| POST | `/api/v1/auth/login` | Create browser session |
| POST | `/api/v1/auth/logout` | Revoke current session |
| GET | `/api/v1/account/me` | Current account and business summary |
| PATCH | `/api/v1/business-profile` | Update business identity |
| POST | `/api/v1/auth/forgot-password` | Request reset link |
| POST | `/api/v1/auth/reset-password` | Reset password and revoke sessions |

## Registration request
Send JSON matching the registration contract in `docs/saas/03-api-contracts.md`, plus an `Idempotency-Key` header (8–128 URL-safe characters). Email verification links point to `SAAS_WEB_URL/verify-email?token=...`; password reset links point to `SAAS_WEB_URL/reset-password?token=...`.

The first outlet is always on-premise Windows for this initial trial flow. Hosted provisioning is deliberately not exposed yet. The API creates a queued `windows_trial` job; no 14-day period begins until a future worker confirms provisioning success.

## Operational limitations before production
- Configure a durable email queue/retry strategy; SMTP sends currently happen after the database transaction and failures are logged for manual resend.
- Replace in-memory rate-limit storage with a shared Redis store before running multiple API instances.
- Deploy behind HTTPS with a deliberate trusted-proxy configuration. Use the same registrable site for portal and API to retain the Lax session cookie policy.
- Add PostgreSQL-backed integration tests and validate migrations against a clean PostgreSQL instance.
- Add a distributed worker and a narrow authenticated hub adapter before marking trials active.
- Terms text and privacy text must be published and reviewed; the API records the supplied terms version but the web consent UI is not included in this service commit.
- Business PAN/GSTIN checks validate syntax only, not government registration status.
