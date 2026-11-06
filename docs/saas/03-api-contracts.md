# SaaS API contracts

Base path: `/api/v1`. Keep this separate from outlet POS `/v1` and hub `/v1` APIs. All JSON responses use `{ success, data }` or `{ success:false, error:{code,message,details?} }`. Validate all inputs with Zod.

## Authentication
- POST `/auth/register`
- POST `/auth/login`
- POST `/auth/verify-email`
- POST `/auth/resend-verification`
- POST `/auth/forgot-password`
- POST `/auth/reset-password`
- POST `/auth/refresh`
- POST `/auth/logout`
- GET/PATCH `/account/me`

Registration is a single onboarding transaction with these sections:
- Account: `fullName`, `email`, optional `phone`, `password`.
- Business: `tradeName`, optional `registeredBusinessName`, `businessType`, `industry`, optional `pan`, `gstin`, `cin`, `fssaiLicense`, `websiteUrl`, `businessEmail`, `businessPhone`, registered address.
- First outlet: `outletName`, optional `outletCode`, outlet phone/email, full address, optional outlet GSTIN/FSSAI licence and timezone.
- Deployment: MVP demo signup selects `on_premise` + `windows`; hosted deployment remains a later gated capability.

Response returns user/org/outlet IDs and verification state. Do not return an authenticated session until email verification succeeds. Create user, organization, owner membership, business profile, first outlet and trial/provisioning request transactionally or through a durable idempotent workflow. Do not start the 14-day trial clock until provisioning succeeds.

Example (address values are illustrative):
```json
{
  "fullName": "Alex Owner",
  "email": "owner@example.com",
  "phone": "+919876543210",
  "password": "a-long-user-chosen-password",
  "business": {
    "tradeName": "Sakura Cafe",
    "registeredBusinessName": "Sakura Foods Private Limited",
    "businessType": "cafe",
    "industry": "food_service",
    "gstin": "optional",
    "fssaiLicense": "optional",
    "businessPhone": "+919876543210",
    "address": {
      "addressLine1": "12 Example Road",
      "city": "Bengaluru",
      "state": "Karnataka",
      "postalCode": "560001",
      "countryCode": "IN"
    }
  },
  "outlet": {
    "name": "Sakura Cafe - Indiranagar",
    "phone": "+919876543210",
    "city": "Bengaluru",
    "state": "Karnataka",
    "postalCode": "560038",
    "timezone": "Asia/Kolkata"
  }
}
```

Tax IDs are optional for demo signup. Validate PAN/GSTIN syntax and state-code consistency when supplied; production tax compliance and invoice validation require accountant review. Never ask for bank credentials or payment card details in the registration form.

## Trials and activation
- POST `/trials` — authenticated, idempotent; body `{ organizationId, outletName, deploymentType:"on_premise", platform:"windows" }`.
- GET `/trials/current`
- GET `/provisioning/:jobId`
- POST `/activation/challenges` — authenticated; creates short-lived one-time challenge scoped to an outlet.
- POST `/activation/complete` — challenge code + hardware ID + POS version; requires verified owner session or a narrowly scoped activation credential.

Trial provisioning starts once per organization. Enforce unique trial entitlement server-side. Trial start is set to successful provisioning time. Activation code plaintext is returned once and stored hashed.

## Organization and outlets
- GET `/organizations`
- GET/PATCH `/organizations/:organizationId`
- GET/POST `/organizations/:organizationId/outlets`
- GET/PATCH `/outlets/:outletId`
- GET `/outlets/:outletId/devices`
- POST `/outlets/:outletId/devices/:activationId/deactivate`
- GET `/outlets/:outletId/licence`

Every route checks authenticated membership and role. Never authorize using a client-supplied organization ID alone.

## Plans and billing
- GET `/plans`
- GET `/subscriptions/current`
- POST `/subscriptions/checkout`
- POST `/subscriptions/change-plan`
- POST `/subscriptions/cancel`
- GET `/payments`
- GET `/invoices`
- GET `/invoices/:invoiceId/download`
- POST `/webhooks/razorpay` (raw body, signature validation, event deduplication)

Checkout accepts a plan code and billing snapshot. Server calculates amount from active plan catalogue; never accept price/total from browser. Use integer paise.

## Admin (separate permission namespace)
- GET `/admin/overview`
- GET `/admin/customers`
- GET `/admin/provisioning-jobs`
- POST `/admin/provisioning-jobs/:jobId/retry`
- POST `/admin/trials/:subscriptionId/extend`
- GET `/admin/licences`
- POST `/admin/licences/:licenceId/revoke`
- GET `/admin/payments`
- GET `/admin/audit-logs`

Require admin role, MFA and audit every privileged action.

## Idempotency
Require `Idempotency-Key` for registration, trial creation, activation completion, checkout and licence issuance. Persist key + request hash + result; same key/same request replays result; same key/different request returns 409.

## Error codes
`VALIDATION_ERROR`, `EMAIL_NOT_VERIFIED`, `ORGANIZATION_FORBIDDEN`, `TRIAL_ALREADY_USED`, `TRIAL_EXPIRED`, `PROVISIONING_IN_PROGRESS`, `ACTIVATION_CODE_INVALID`, `ACTIVATION_CODE_EXPIRED`, `HARDWARE_ALREADY_BOUND`, `ENTITLEMENT_LIMIT_REACHED`, `PAYMENT_NOT_VERIFIED`, `IDEMPOTENCY_CONFLICT`.

## Security
Use secure, HttpOnly, SameSite cookies for browser sessions where practical; CSRF protection for cookie-authenticated mutations. Rate-limit login, verification, trial and activation. Never return hub admin secrets or signing keys.
