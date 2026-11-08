# ADR-0006: Customer accounts, self-service demos, automatic licences and billing

Status: accepted (2026-11-07). Phase 7 (P7-01 to P7-07). P7-01 to P7-04 built.

## Context

Licences today (P2-09) are made by hand: the owner of DinePOS (the vendor) runs the offline keygen
(`C:\Users\PL\Documents\dinepos-keygen`) with the customer's hardware id and pastes or uploads the key. Renewals reach
the outlet through DinePOS Cloud (`GET /v1/pos/licence`, fetched hourly, installed by `RenewLicence`).

The vendor wants the product website (posinext.com) to sell DinePOS without manual steps:
- a visitor asks for a demo and the demo is ready at once;
- a customer makes an account, picks a plan, pays, and gets their licence;
- the customer manages outlets, PCs, seats, team members and invoices from a portal.

The vendor's decisions (2026-11-07):
1. Cloud-signed licences: **a second signing key in the cloud** with limits. The offline key stays the master key.
2. Payments: **Razorpay**.
3. Demo: **both** an instant browser demo (a hosted outlet) and a 14-day Windows trial.
4. Website: **served by DinePOS Cloud** (marketing pages, sign-up and portal in one service, one domain).

## Decision

### 1. Accounts live in DinePOS Cloud (`cloud/hub`)

There is no new service. New tables are added to the hub database the same way as the existing ones
(`CREATE TABLE IF NOT EXISTS` in `cloud/hub/src/db.ts`). There are still no runtime dependencies: passwords use
`scrypt` from `node:crypto`, and Razorpay and email are called with `fetch`.

| Table | Purpose |
|---|---|
| `account` | A customer business: name, GSTIN, billing address, state code (for GST place of supply), created_at, status (`new` until a trial starts, then `trial`, `active`, `past_due`, `suspended`, `closed`) |
| `account_user` | A person who can sign in: email (unique, lower-case), scrypt password hash, verified_at, role in the account (`owner`, `admin`, `billing`) |
| `account_session` | A portal sign-in: token hash, user, expires_at (30 days rolling), user agent |
| `email_code` | One-time codes for verifying an email and resetting a password: hash, purpose, expires (10 min), attempts (5) |
| `account_store` | Links the account to its stores (the existing `store` table): the account owns its outlets |
| `licence_grant` | Every key the cloud signs: account, store, hardware id, kind (`trial`, `paid`, `demo`), seats, features, issued/expires, key text, revoked_at. Append-only, like an audit log |
| `trial_claim` | Unique hardware id, email and phone hashes, so each gets one trial only |
| `plan`, `plan_price` | Plans and add-ons the vendor sells (edited on the admin page, never hard-coded): seats, features, price in paise per period |
| `subscription` | Account + plan + add-ons, current period start/end, auto-renew, Razorpay ids |
| `invoice`, `invoice_line` | GST tax invoices: gap-free number per financial year (like bill numbers), amounts in paise, tax in basis points, immutable once issued (a correction is a credit note) |
| `payment` | Razorpay order/payment ids, amount, state, raw webhook payload hash. Webhooks are idempotent on the Razorpay event id |
| `demo_request` | Website demo requests: contact details, chosen demo type, source, state, converted_at |

Money is integer paise and tax rates are basis points, using `cloud/core/money.ts` and `cloud/core/tax.ts`.

### 2. The cloud signs keys with its own key, within limits

- The cloud has its own Ed25519 key pair. **Built (P7-02):** the pair was made on the vendor's PC in the keygen folder
  (`keys/dinepos-cloud-signing-private.pem`, beside the master key, backed up the same way), because the app must
  embed its public half before any cloud runs. It is installed on the server with
  `npm run admin -- cloud-key import <file.pem>`. That copies it to `<HUB_DATA_DIR>/licence-signing-key.pem` with
  mode 0600 (or to `HUB_LICENCE_SIGNING_KEY_FILE`); the private key is never sent anywhere.
- The DinePOS server embeds **two** public keys: `master` (the existing one) and `cloud`.
  `apps/server/src/licence/public-key.ts` becomes a list `{ id, publicKey, maxDays }`. A key whose `kid` names neither is
  refused ("not genuine"), as is a cloud key with no valid `issuedAt`.
- The key format stays `v: 1` with an optional new field, `kid` (which key signed it); a missing `kid` means `master`,
  so every existing key keeps working. A key signed by `cloud` is accepted only when
  `expiresAt − issuedAt ≤ 400 days`. `master` keys have no such limit.
- If the cloud key leaks, an attacker can only make keys of at most 13 months. The vendor ships an app update that
  drops or replaces the `cloud` public key; `master` keys are unaffected.
- The cloud signs a key in three cases:
  - a trial is activated;
  - a payment succeeds (a new key covering the new period);
  - a customer moves their licence to a new PC.

  Each grant is put in the store's licence slot (`GET /v1/pos/licence`), so the existing hourly renewal delivers it.
  The first activation also returns the key directly.

### 3. Activation from the Windows app

- Settings › Licence (and the "no licence" first-run screen) gets **Sign in to your account** and **Start free
  trial**, next to the existing "Paste key".
- The app's server calls `POST <cloud>/v1/activate` with the account email and password (or a one-time activation
  code shown in the portal), the hardware id and the outlet name. The cloud:
  - links the store, creating one if needed;
  - pairs the outlet's device key, the same pairing as Cloud sync;
  - signs a key for that hardware id and returns it.

  The server installs it with `InstallLicence`.
- **Built (P7-03):**
  - **The route:** `POST /v1/licence/activate` `{mode: trial|signin, email, password}` on the outlet server (right
    `admin`). It calls `<cloud>/v1/activate` (the linked order hub, else `https://portal.posinext.com`;
    `DINEPOS_CLOUD_URL` overrides). Then it runs `InstallLicence` and, the first time, `SaveOnlineLink`. The
    password is passed through only: never stored, logged or audited.
  - **Sign in:** returns the account's existing non-demo key for this PC. With none, the answer is `NO_LICENCE`.
  - **The trial:** 14 days, 1 terminal, 1 captain and 1 KDS. The account becomes `trial`. Each PC, email and phone
    is claimed in `trial_claim`.
  - **The warning:** trial and demo keys carry the feature `trial`, so the app shows "Free trial until …" and warns
    only in the last 2 days (paid keys: 15).
- Billing stays offline-safe: once installed, the key is checked locally. The cloud is never needed at service time,
  and the 7-day grace and "never block mid-service" rules are unchanged.

### 4. Demos

- **Windows trial (14 days):** sign up on the website (verify the email with a code; phone required). Download the
  installer, then choose **Start free trial** on first run. The trial key gives 1 terminal, 1 captain, 1 KDS and all
  features. Each hardware id, email and phone gets one trial (`trial_claim`). The vendor can extend a trial on the
  admin page.
- **Instant browser demo:** "Try it now in your browser" makes a hosted outlet (P6-04) from a demo template: sample
  menu, tables, staff and PINs shown on screen. The cloud's own key licenses it. It opens at once in the browser
  through `https://<demo-slug>.<cloud>`. **Built (P7-04):**
  - **The terminal:** the billing terminal's own screens (the Electron renderer, which has no Electron-only code)
    are served by the outlet server at `/pos/`. In a browser it uses the server that served it. The cloud pairs
    one terminal and hands its device token over in the address fragment (`/pos/#device=<token>`), which no server
    or log sees. The terminal keeps it as if paired and takes it off the address.
  - **The sample outlet:** the development seed, written as `cloud/outlet-server/demo-seed.json` by
    `npm run bundle:cloud`. The cloud sends it as ordinary commands, so the outlet server stays the only writer.
  - **The licence:** a 3-day `demo` grant, installed directly with `InstallLicence`.
  - **Limits:** the demo is deleted (server stopped, data folder removed) after 72 hours. At most `HUB_MAX_DEMOS`
    run at once (default 10); when they are all in use, the visitor is offered the Windows trial. Each account gets
    3 demos and 5 starts a minute per IP. Only a signed-in person with a verified email can start one, from the
    portal.
- Abuse limits: rate limits per IP and per email on sign-up and demo; a verified email is required for both demo
  types.

### 5. Payments (Razorpay)

- Checkout uses Razorpay Orders and Standard Checkout for each period (monthly or yearly). Razorpay Subscriptions
  (auto-debit by UPI AutoPay or card mandate) are added for auto-renew once the plan list is settled.
- The browser never sets the price. The cloud creates the Razorpay order from the plan in its own database.
- Payment is confirmed only by:
  - the webhook (`payment.captured`, `order.paid`), checked with HMAC-SHA256 of the raw body using the webhook
    secret; or
  - the checkout handler's `razorpay_signature`, checked on the server.

  Each event is processed once (idempotent on the event id), in one transaction:
  1. payment row;
  2. invoice (GST, gap-free number);
  3. subscription period extended;
  4. licence grant signed;
  5. key put in each linked store's licence slot.
- Failed or late renewals: the subscription becomes `past_due`, and the existing licence states take over (warning at
  15 days, 7-day grace, then no new business date). The cloud never switches an outlet off remotely.
- Secrets (Razorpay key secret, webhook secret) are stored like the UrbanPiper key: never sent to a browser and never
  shown again after saving. The mail API key is in the server's environment (`HUB_BREVO_API_KEY`, P7-01).

### 6. Portal and website (served by the cloud)

- `/` marketing pages, `/pricing` (read from `plan`), `/demo`, `/signup`, `/login`, legal pages (terms, privacy,
  refund and cancellation: Razorpay requires them).
- `/app` customer portal: dashboard (plan, days left, outlets online), Outlets, Licences (hardware ids, seats in use,
  move to a new PC once per 30 days), Billing (plan, add-ons, pay, invoices, auto-renew), Team (invite by email,
  roles), Downloads (installer, print agent), Account (profile, GSTIN, password).
- Vendor admin page (`admin.html`, existing admin key): accounts, demo requests and conversion, trials (extend),
  issue or revoke a grant, plans and prices, coupons, payments and failed renewals, invoices export.
- Plain HTML, CSS and JS pages in `cloud/hub/public/`, like the existing ones. The design and assets are original.

## Consequences

- The cloud now holds customer personal data and payment records. Backups (`deploy/backup.sh`) cover the new tables,
  the portal needs HTTPS (already there), and the privacy page must say what is kept.
- The licence verifier in `apps/server` changes (a second public key and the `kid` field). Old keys stay valid, and a
  new key is refused by an old app build only if it carries `kid: "cloud"`. Outlets on an old build keep using
  master keys.
- The vendor still needs the offline keygen for long or special keys and to recover if the cloud key is replaced.

## Decided 2026-11-07 (product owner)

- **GST:** 18% on the subscription (1800 basis points), SAC 997331. Still needed before P7-05 ships: the vendor's
  GSTIN and state (CGST + SGST inside the state, IGST outside), and whether list prices include GST.
- **Plans:** two paid plans at **₹799 per month** and **₹1,999 per month**, and a third, **Custom**, shown as "Contact
  us for a quote" (no online checkout; the vendor makes a custom plan for that account on the admin page). Seats and
  features per plan, plan names, and any yearly price are data on the admin page (first set to be confirmed).
- **Email:** a free provider. **Brevo** (free plan, 300 emails a day, HTTP API) behind the mailer interface, so it can
  be swapped for another. Development writes codes to the log.
- **Domain:** the portal and sign-up are at **`portal.posinext.com`**; `posinext.com` is the product website. Outlets
  stay at `<store>.<cloud>`.
