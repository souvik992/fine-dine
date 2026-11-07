# Fine Dine SaaS API (initial auth foundation)

This is a separate Node.js service. It does not import or modify the outlet POS server, its SQLite database, or the existing hub.

## Requirements
- Node.js 22+
- PostgreSQL 14+
- SMTP credentials for production email delivery

## Local setup
From the repository root:

```powershell
cd cloud/saas
Copy-Item .env.example .env
# Create a dedicated PostgreSQL database named finedine_saas and update DATABASE_URL.
npm install
npm run migrate
npm run dev
```

The migration runner reads the SQL files in `packages/saas-db/migrations` and records applied filenames in `saas_schema_migrations`. It takes a PostgreSQL advisory lock and applies each migration in its own transaction. Never point it at an outlet SQLite database.

In local development, email links are written to the API logger. Configure SMTP variables to test real delivery. Production startup refuses to run without SMTP credentials and an HTTPS portal URL.

## Implemented endpoints
- `GET /health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/resend-verification`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/account/me`
- `PATCH /api/v1/business-profile`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`

Registration creates a pending owner account, organization, business profile, first on-premise outlet and a queued Windows trial provisioning job in one PostgreSQL transaction. It does not start the 14-day trial clock: the future provisioning worker must start the trial only after the hub/outlet provisioning has succeeded.

## Security notes
- Passwords use Node's built-in scrypt with per-password random salts.
- Session, verification and reset tokens are random and only their SHA-256 digests are stored.
- Verification and reset tokens are one-time and expire.
- Password reset revokes all active sessions.
- Browser sessions use HttpOnly, SameSite=Lax cookies; Secure is enabled in production.
- Login, registration, resend and reset routes have rate limits. The current rate-limit store is in-process; production deployments with multiple API instances must configure a shared Redis store before scaling horizontally.
- CORS allows only configured origins. Put the API behind TLS and a trusted reverse proxy, and set the proxy trust policy deliberately before production.
- Business tax IDs are syntax-checked only. The API does not query government registries or certify tax registration.
- Terms acceptance version is recorded in the registration audit event.

## Not yet implemented
- Customer-facing React signup/login/verification screens.
- Distributed rate-limit store and CSRF token strategy for cross-site deployments.
- Email delivery queue/retry and provider-specific templates.
- Organization team invitations and multi-organization switching.
- Trial provisioning worker and hub adapter.
- Razorpay, subscriptions and invoice generation.
- Automated integration tests against PostgreSQL.
