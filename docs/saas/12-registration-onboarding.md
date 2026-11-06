# Registration and business onboarding

## Customer journey
1. Visitor selects **Start 14-day Windows demo**.
2. Visitor enters owner account details, business profile and first outlet details.
3. API validates all fields and creates the pending user, organization, owner membership, business profile and outlet using a single database transaction plus a durable idempotency record.
4. API sends a short-lived, single-use email verification link. The browser shows a neutral confirmation message and resend cooldown.
5. Customer verifies email. Only then can the user establish a customer portal session.
6. Provisioning worker creates or reconciles the hub store and prepares the Windows trial entitlement.
7. Trial starts when provisioning is confirmed ready; the 14-day clock does not run while a job is queued or failing.
8. Customer receives a download/activation link and can activate the master Windows PC.
9. Customer can update business and outlet details later. Changes are permission-checked and audited.

## Required versus optional
Required:
- Owner full name, email, password.
- Business trade/display name and business type.
- First outlet name and physical address (address line, city, state, postal/PIN code and country).
- Consent to Terms and Privacy Policy (store policy version and timestamp when implemented).

Optional:
- Owner phone, registered legal name, website, PAN, GSTIN, CIN, FSSAI licence, business email/phone.
- Outlet phone/email, outlet code, outlet GSTIN/FSSAI.
- Address line 2, locality and district.

A demo must not be blocked because a small business has not yet received its GSTIN, PAN or FSSAI number. Tax details can be added later. Do not collect bank credentials or payment details during trial signup.

## Business-type taxonomy
Persist stable lowercase codes, not display labels. Initial values:
- restaurant
- cafe
- qsr
- bakery
- cloud_kitchen
- food_truck
- grocery
- retail
- other

The list is extensible. Do not assume that Fine Dine will only ever serve restaurants.

## India-first validation
- Normalize email with trim + lowercase.
- Normalize phone to E.164 where possible; retain raw input only if normalization is not possible.
- PAN: validate the standard 10-character syntax when supplied.
- GSTIN: validate 15-character syntax and ensure its state prefix agrees with the selected state where a state code is available. Syntax validation is not a government registration lookup.
- PIN: validate six digits for India; use country-aware validation elsewhere.
- Store country as ISO 3166-1 alpha-2 and timestamps as UTC.
- Default Indian outlet timezone to Asia/Kolkata, but allow an explicit IANA timezone.

## Privacy and permissions
- Owner/admin can edit business profile; billing contact may edit billing details only.
- Outlet manager can edit permitted outlet operational contact fields, not organization legal identity or subscription ownership.
- Mask PAN/GSTIN in read-only summaries where full values are not required.
- Audit changes to tax IDs, legal name, billing address, organization ownership and outlet identity.
- Never log passwords, session tokens, verification/reset tokens, or full activation secrets.
