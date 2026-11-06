# SaaS UI screen specification

## Frontends
Use three route groups; one React/Vite app can host public pages and customer portal initially. Keep super-admin routes and permissions separate.

## Public website
- Home: Fine Dine positioning, product screenshots, Windows demo CTA.
- Features: billing, table management, KOT, inventory, reports, Captain, KDS.
- Pricing: monthly/yearly toggle, plan entitlements loaded from API.
- Demo signup: owner details, email, phone, organization and outlet.
- Verify email: OTP/link state and resend cooldown.
- Download: installer version, release notes, system requirements, activation guide.
- Login, forgot/reset password, help/contact.

## Customer portal
- Dashboard: trial/subscription status, expiry/countdown, outlets, licence and sync status.
- Outlets: list/create/edit and deployment type.
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
