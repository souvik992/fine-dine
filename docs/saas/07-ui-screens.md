# SaaS UI screen specification

## Frontends
Use three route groups; one React/Vite app can host public pages and customer portal initially. Keep super-admin routes and permissions separate.

## Public website
- Home: Fine Dine positioning, product screenshots, Windows demo CTA.
- Features: billing, table management, KOT, inventory, reports, Captain, KDS.
- Features/pricing: monthly/yearly toggle, plan entitlements loaded from API.
- Demo signup: a guided three-section form: owner account, business profile, first outlet.
- Verify email: OTP/link state and resend cooldown.
- Download: installer version, release notes, system requirements, activation guide.
- Login, forgot/reset password, help/contact.

## Demo signup fields

### 1. Owner account
- Full name (required)
- Work email (required, unique, verified before sign-in)
- Mobile number with country code (optional initially)
- Password and confirmation (required; enforce server-side strength rules)

### 2. Business profile
- Trade/business display name (required)
- Registered legal name (optional if sole proprietor/trading name)
- Business type (required): Restaurant, Cafe, QSR/Fast Food, Bakery, Cloud Kitchen, Food Truck, Grocery, Retail, Other
- Industry/category (required; extensible)
- Business email and phone (optional; may default to owner contact)
- Website (optional)
- PAN (optional)
- GSTIN (optional; validate format if entered)
- CIN/company registration number (optional)
- FSSAI licence number (optional for food businesses)
- Registered address: address lines, locality, city, district, state, PIN/postal code, country

### 3. First outlet
- Outlet/branch name (required)
- Outlet code (optional)
- Outlet phone and email (optional)
- Outlet address (required for tax/invoice and service context): address lines, locality, city, district, state, PIN/postal code, country
- Outlet GSTIN and FSSAI licence (optional; allow values different from organization profile)
- Timezone (default from selected country/location; default India to Asia/Kolkata)
- Deployment: Windows on-premise demo (selected); hosted mode disabled until supported

Do not make GSTIN, PAN, CIN, FSSAI, website or business email mandatory for starting a demo. Make it clear that tax details can be completed later in Business Settings. Do not collect bank account credentials or card details on the demo signup form.

## Customer portal
- Dashboard: trial/subscription status, expiry/countdown, outlets, licence and sync status.
- Business settings: legal/trade name, business category, tax registrations, registered address and billing contacts.
- Outlets: list/create/edit and deployment type; each outlet has its own address, contact, GSTIN and FSSAI fields.
- Outlet detail: hardware binding, licence, device seat usage, last contact.
- Licence: status, issue/expiry, hardware replacement request.
- Devices: master, terminal, Captain and KDS activations; deactivate with confirmation.
- Downloads: signed installer URLs and release notes.
- Billing: plan, renewal date, upgrade/downgrade/cancel.
- Payments: status and receipts.
- Invoices: PDF, GST and billing details.
- Team: invite members and assign owner/admin/manager/billing roles.
- Support and account settings.

## Super-admin
- Overview: active subscriptions, trials, MRR, failed jobs and payment exceptions.
- Customers and organization detail.
- Outlet/deployment registry.
- Trial provisioning queue, job attempts and safe retry.
- Licence lookup, revoke and replacement with mandatory reason.
- Plan catalogue and entitlement editor.
- Payments, webhook events and reconciliation.
- Installer versions/channels.
- Support queue and append-only audit log.

## UX rules
- Show SaaS connectivity and POS/hub connectivity as distinct statuses.
- Clearly distinguish subscription expiry from installed licence expiry.
- Display when licence was last checked by the outlet.
- Never display full signed licence key or activation secret after first display.
- Use explicit confirmation for revoke, deactivate, cancel and hardware replacement.
- Every screen has loading, empty, error and permission-denied states.
- Mobile responsive for owners; installer downloads and device activation primarily desktop.
