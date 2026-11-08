# ADR-0007: One backend (DinePOS Cloud), a portal for two products, Windows downloads with 30-day trials

Status: accepted (2026-11-08). Phase 8 (P8-01 to P8-10). Changes parts of ADR-0006 (see "What changes").

## Context

After Phase 7 there were three places doing account work: DinePOS Cloud (`cloud/hub`: accounts, cloud-signed keys,
trials, demos), the saas-portal repository (a SaaS API on SQLite, and the shared licensing library), and the live
portal at portal.posinext.com (a Lovable site with its own Supabase login, connected to neither).

The product owner's decisions (2026-11-08):
1. **DinePOS Cloud is the one backend and database** for every product. The saas-portal repository keeps **the portal
   UI only**; its API is removed, and the licensing library moves into this repository.
2. **The portal is rebuilt in saas-portal (`cloud/saas-web`)** in the DinePOS look (orange buttons, Manrope and
   Fraunces), and replaces the Lovable site at portal.posinext.com. After sign-in it opens on a home page of tiles in
   the style of a hosting client area (WHMCS): account, downloads, licences, add-ons, support tickets, announcements,
   knowledge base, plans, service status.
3. **Two products: QSR (Tiffin POS) and Fine Dine (DinePOS).** A customer chooses one (or both) and downloads its
   Windows installer and add-ons (Tiffin: ODS; DinePOS: Table QR).
4. **No browser demo.** The trial is the Windows app: **30 days**.
5. **The trial key comes from signing in inside the app**: on first start the app asks for the portal email and
   password, sends the PC's hardware id, and gets a 30-day key for that PC (the DinePOS flow of P7-03). A key cannot be
   made at download time, because it is bound to a PC whose hardware id is not known yet.
6. **Tiffin POS gets licensing** (in the tiffin repository), the same as DinePOS.
7. **New builds on every push**: installers and the portal are built by CI and published; the portal's downloads
   always offer the newest build.

## Decision

- **Products in the hub.** A `product` column on licence grants and trial claims: `fine_dine` or `tiffin_qsr`. Keys say
  `product`, and each app accepts only its own (DinePOS also accepts unlabelled keys made before). One trial per
  product per account, per PC and per mobile.
- **Licensing library** in `packages/licensing` (this repository): the key format, signing, checking, status and hardware
  ids. The hub imports its source (no build step); the DinePOS app keeps its own checks for now. The
  `vendor/saas-portal` submodule is removed.
- **Downloads** are GitHub Releases of the public repositories: fine-dine publishes `DinePOS-Setup-<v>.exe` and
  `DinePOS-TableQR-Setup-<v>.exe`, tiffin publishes `TiffinPOS-Setup-<v>.exe` and `TiffinPOS-ODS-Setup-<v>.exe`, on
  every push to main. The hub keeps a catalogue (`GET /v1/downloads`, refreshed from the GitHub API) and records
  each download by a signed-in account.
- **Portal hosting:** the built portal is published by saas-portal's CI; the cloud server fetches it on update and the
  hub serves it on the `portal.` host, with the API on the same origin (the HttpOnly session cookie needs no
  cross-site rules). portal.posinext.com is pointed at the cloud server when the new portal is ready.
- **Support, announcements, knowledge base** are hub tables with admin-page editing; the portal reads them.

## What changes from ADR-0006

- The browser demo (P7-04) is withdrawn from the portal and its routes are switched off; the code stays until removed.
- The trial is 30 days (was 14).
- The vendor console and portal features of P7-06 and the website of P7-07 are covered by Phase 8. P7-05 (plans and
  Razorpay) is unchanged and still waits for the GST and price decisions; the portal shows plans when it is built.

## Consequences

- One database to back up and one place for account rules. The portal can be redeployed without touching the backend.
- Tiffin POS outlets activate against DinePOS Cloud for licences, while their orders still go through the Tiffin hub.
- Unsigned installers (no code-signing certificate yet) show Windows SmartScreen warnings.
