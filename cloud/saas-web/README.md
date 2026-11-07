# Fine Dine customer portal

Separate React + TypeScript + Vite frontend for the SaaS account API. It does not join the repository root workspaces or alter the POS/hub runtime.

## Local development

```powershell
cd cloud/saas-web
Copy-Item .env.example .env
npm install
npm run dev
```

Set `VITE_SAAS_API_URL` to the API origin (default `http://localhost:4100`). Run the API from `cloud/saas` in a second terminal. Configure the API's `SAAS_ALLOWED_ORIGINS` to include the portal origin and keep both services on the same registrable site in production so the HttpOnly SameSite=Lax session cookie is sent.

## Routes

- `/register` — owner, business and first-outlet registration; includes terms acceptance and an `Idempotency-Key`.
- `/login` — email/password login.
- `/verify-email?token=...` — consumes the one-time verification token.
- `/forgot-password` — requests a reset email.
- `/reset-password?token=...` — sets a new password.
- `/dashboard` — account overview and business profile editor.

The business profile editor deliberately leaves PAN/GSTIN inputs blank and only sends replacements when entered. The API update query uses `COALESCE` for these identifiers, preserving existing values when omitted.

This portal is an initial account-management UI, not a complete billing console. Subscription checkout, outlet/device management, trial provisioning status, team management and payment history are not exposed yet.
