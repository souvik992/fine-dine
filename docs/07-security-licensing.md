# 07 — Security, licensing and backups

Threat model: staff misuse (voids, reprints, discounts), guests or neighbours on shared Wi-Fi, lost
phones, disk failure. Not: nation-state attackers.

## Device pairing
1. New device opens the app → enters master IP (or picks the server found on the network, P2-15) → requests pairing → gets a 6-digit code.
2. Manager approves in Settings › Devices on the master/desktop (PIN required).
3. Server issues a 256-bit random device token, stores SHA-256 hash, device name, kind (terminal/captain/kds).
4. Every HTTP/WS call carries the token. Revoke = delete row → immediate 401.

Built in P2-02 (`apps/server/src/auth/devices.ts`, migration 0007):
- `POST /v1/pairing-requests` `{ name, kind }` (public) → `{ requestId, secret, code, expiresAt }`: a 6-digit code for
  10 minutes (at most 20 waiting). The device polls `POST /v1/pairing-requests/:id/collect` `{ secret }`; after
  approval the first collect makes the token (only `sha256("device:" + token)` is stored) and closes the request, so
  the token is handed out once.
- `PairDevice` `{ code, name? }` (right `admin`, **always** a manager PIN) creates the device row and approves the
  request. `RevokeDevice` `{ deviceId }` sets `revoked_at`, clears the token hash (the row stays for the audit trail),
  ends the device's sign-ins and closes its live connection at once (`device.revoked`, WS close 4403). The master PC
  and the requesting device itself cannot be revoked.
- Every request except `/v1/health` and pairing needs `Authorization: Device <token>`; otherwise 401 with
  `details.reason = "device_not_paired"`. The stream checks the hello's `deviceToken` (refused: close 4401).
- **Decided 2026-11-03:** requests from the master PC itself (loopback) are the built-in device "Master PC" (the row
  from 0004) and need no token: whoever can use that PC can already read its disk, and an existing install keeps
  working after the upgrade. `DINEPOS_TRUST_LOOPBACK=0` turns this off (tests that play a second PC).
- Sign-ins record their device (`user_session.device_id`); `GET /v1/devices` (admin) lists devices and waiting codes;
  `GET /v1/device` names this device. Terminals show "Pair this terminal" when the server does not know them.

## Users and PINs
- Staff log in with a 4–6 digit PIN (unique per outlet). Hash: Argon2id.
- 5 wrong PINs → lock that user 5 min; audit it.
- Session token per device+user; auto-logout after configurable idle time (default 10 min on terminals,
  off on captain).

Built in P2-01 (`apps/server/src/auth/`):
- First run: `SetupOutlet` (outlet name + owner name + PIN) is the only command accepted without a session, and only
  while no staff exist. `GET /v1/setup-state` (public) returns `setupNeeded`, the outlet name and active staff names.
- Sign-in = tap your name, type your PIN (`POST /v1/sessions {userId, pin}`), as in Tiffin POS; PINs are still unique
  per outlet. Hash: **scrypt** (node:crypto, N=2^14, salted) instead of Argon2id, to avoid a native module on shop PCs.
- 5 wrong PINs lock that person for 5 minutes (`auth.lock` audited); a new PIN set by a manager unlocks them.
- Session token: 256-bit random, only its SHA-256 stored, expires 12 h after last use; terminals lock after 10 idle
  minutes (client) and on Lock / Ctrl+L. `GET /v1/session`, `DELETE /v1/session`.
- Manager approval: the client resends the same command with `X-Manager-Pin`; the PIN must belong to an active person
  whose role has the right without a PIN (and, for discounts, a high enough limit). 5 wrong manager PINs per session
  per minute are refused. The approver is stored in `audit_event.approved_by`.
- Until device pairing (P2-02), read-only GETs (floor, menu, orders, printers, config) and the WebSocket stream do not
  need a session; every command does. `GET /v1/staff` and `/v1/roles` need "manage staff".

## Rights
Roles: Owner, Manager, Cashier, Captain, Kitchen (defaults, editable). Rights are strings like
`kot.cancel`; each right has `allowed` and `needsPin` per role. Discount limit (%) per role.

Defaults (migration 0004; edit with `UpsertRole`): Owner everything; Manager everything except `users.manage`, 20%
discount; Cashier billing and orders, 10%, with a manager PIN for `kot.modify`, `kot.cancel`, `reprint`, `bill.void`,
`drawer.open`, `cash.move`, `staff.sections` (captains' sections; Owner and Manager, P3-04), `reservation.manage` (bookings and the waitlist; Owner,
Manager, Cashier and Captain, P4-04), `online.orders` (accept, reject and move on online orders; Owner, Manager and
Cashier, P4-06); Captain orders and firing, PIN for changes to fired items; Kitchen `kds.bump`,
`menu.stock`. `reports.view` (migration 0008) goes to Owner and Manager. `stock.manage` (materials, purchases, wastage, counts, recipes, stock reads; migration 0005) goes to
Owner and Manager. `menu.stock` is "mark items sold out" (Owner, Manager, Cashier, Kitchen). A PrintBill discount above the role limit needs a manager PIN and is a leakage flag. Safety rules: the
Owner role always keeps `users.manage`; nobody can deactivate themselves or change their own role; at least one
active person must be able to manage staff; changing a PIN, role or active flag signs that person out everywhere.

## Transport
- Server binds to LAN interfaces only. HTTPS with a per-outlet self-signed cert generated at install;
  fingerprint shown during pairing and pinned by the device.
- Dev mode may use plain HTTP on localhost.

## Licence (owner's keygen)
- Key = signed payload `{outletId, hardwareId, expiresAt, seats: {terminals, captains, kds}, features}`
  signed with your Ed25519 private key; the app ships only the public key.
- `hardwareId` = hash of stable machine identifiers (e.g. Windows MachineGuid + system disk serial).
  Reinstall on the same machine → same hardwareId → key still valid.
- Checks: on start and every 24 h. Warn from 15 days before expiry. After expiry: 7-day grace, then block
  opening a new business date (never block mid-service).
- Seats enforced at device pairing.
- Keygen CLI lives outside this repo (keep the private key off customer machines).

Built in P2-09 (product owner's decisions 2026-11-03: **no key → billing cannot start**; keygen in a separate folder):
- Key = `base64url(payload JSON).base64url(Ed25519 signature)`; payload `{ v: 1, licensee, hardwareId, issuedAt,
  expiresAt, seats { terminals, captains, kds }, features }` (`apps/server/src/licence/licence.ts`). The app embeds the
  public key only (`apps/server/src/licence/public-key.ts`).
- Keygen: `C:\Users\PL\Documents\dinepos-keygen` (outside the repo; `keygen.mjs init | public | issue | verify`, see
  its README). Its `keys/` holds the private key: back it up offline; never run `init` again.
- Hardware id: SHA-256 of Windows MachineGuid + system-drive volume serial, 20 hex digits as `AB12-CD34-EF56-7890-1A2B`
  (`hardware.ts`), shown in Settings › Licence to send to the vendor.
- States: `none` (no key), `invalid` (forged, or another PC's), `ok`, `expiring` (≤ 15 days left), `grace` (≤ 7 days
  after the end), `expired`. Without a valid key — none, invalid, expired — **no new business date opens**: not at
  server start, not after Day end (which still closes the day and prints the Z-report). A day already open is
  never stopped. Commands then fail `DAY_CLOSED` with the licence message (`details.reason = 'licence'`).
  Installing a valid key (`InstallLicence`, right `admin`; the key is not written to the audit log) opens the day.
- Renewals (P4-05): a key the vendor puts on the hub is fetched hourly and installed by `RenewLicence` when it is
  genuine, for this PC and ends later than the installed key (never shortens a licence; audited `licence.renew`).
- The clock: the server remembers the latest time it has seen (`licence.last_seen_at`); setting the PC clock back
  does not extend a licence.
- Seats at `PairDevice`: terminals count the master PC; revoked devices free their seat; over the limit →
  `INVALID_STATE` (`details.reason = 'seats'`).
- Enforced by the installed server (the bundle) always, with the embedded key; environment variables cannot change
  that. A run from source does not enforce ("Development run") unless `DINEPOS_LICENCE_PUBLIC_KEY` (a test key) is
  set, with optional `DINEPOS_HARDWARE_ID` — the desktop end-to-end suite runs that way.
- `/v1/health` carries `licence { state, canOpenDay, message, daysLeft }` (terminals show a warning on every screen,
  the sign-in screen included); `GET /v1/licence` the details, hardware id and seats in use.
- Not tamper-proof (a determined person can patch a local program); it keeps honest outlets honest.

## Backups
- SQLite online backup API (`db.backup()` in better-sqlite3) every 15 min to `backups/`; retain 7 days
  hourly + 30 days daily; optional second drive/USB path.
- Day-end forces a backup.
- Restore: Settings › Backup › Restore (owner PIN) → stops server, swaps file, restarts.
- Optional encrypted cloud upload (Phase 4).

Built in P2-08 (`apps/server/src/backup/`, approach from TiffinPOS):
- `BackupScheduler`: an `auto` backup every 15 minutes (and at start when the newest is older), a `dayend` backup on
  `day.changed`, `manual` on request. Online backup (`db.backup()`), written as `.tmp`, opened read-only and
  `quick_check`ed (and its schema version ≤ this build) before it is renamed into place; a failure is logged and shown.
- Retention: `auto` — all from the last 2 hours, the newest per hour for 7 days, the newest per day for 30 days;
  `dayend` 90, `manual` 30, `restore` (safety copies) 10.
- Copy folder (`backup.copyDir`, Settings › Backups): every backup is copied there (USB drive, second disk), checked
  again on the drive and pruned the same way; a missing drive is reported, never fatal.
- Restore (Settings › Backups, session with `users.manage` + an Owner's PIN in `X-Manager-Pin`): a `restore` safety
  backup is made, the chosen backup is checked and staged (`restore-pending.json`), the server stops and starts again
  in the same process, and before opening the database moves it (with its WAL) into `pre-restore-<stamp>/` (never
  deleted) and copies the backup in. On any failure the previous database is put back. Work after the backup is
  not replayed (no journal yet): at most 15 minutes. Audited (`backup.restore_staged`, `backup.manual`).
- Command line, when the server cannot start: `server.mjs --list-backups`, `server.mjs --restore <file>`.
- `/v1/health` includes `backup { lastAt, ageMin, ok, error }`; terminals show "Backup late" when over an hour.

## Logging
Rotating JSON logs in `logs/` (pino). Never log PINs, tokens or full customer phone numbers.

## Device rights (P4-02)
A paired kitchen screen works with nobody signed in (docs/06 "no login after pairing"): with no staff session, a
`kds` device — and the master PC itself — may run commands needing `kds.bump` and nothing else
(`DEVICE_RIGHTS` in `apps/server/src/core/rights.ts`). Those commands only change KOT timestamps; the audit row
records the device and no user. Terminals and phones always need a staff sign-in.

## The order hub link (P4-06)
`POST /v1/online/pair` (admin) exchanges the hub's one-time connection link for a device key, stored only in
`online_link` on the master (not in `/v1/config`, never sent to a terminal). Plain `http://` is refused except to a hub on
the same PC. The connector acts as device `system`, whose only right is `online.orders` (automatic accepting); no HTTP
request can carry that kind.

## Add-ons (P5-01, ADR-0004)
- Only packages signed with a key in `ADDON_TRUST_KEYS` (`packages/shared/src/addons.ts`) load; every file's SHA-256 is
  checked and only the checked bytes run; an older version than one already run is refused. The terminal checks the
  signature of an add-on's screens itself before running them (the server cannot make it run unsigned code).
- Signing key: `%USERPROFILE%\.dinepos\addon-signing\private.pem` (created 2026-11-05). Never in the repository; back it
  up offline. Leaked: remove it from `ADDON_TRUST_KEYS` and release DinePOS. Lost: no trusted updates until a release adds
  a new key.
- A signed add-on is fully trusted inside the server (no sandbox). Safety nets: database steps only on `<id>_` tables;
  read-only database access outside its commands; its own actor limited to the rights in its signed manifest; staff
  routes signed in with the route's right; guest routes public, rate limited (`RATE_LIMITED`), strict CSP.
- Table QR: table codes are 18 random bytes, renewable per table (the old printed code stops at once); guests are never
  signed in; at most 5 requests waiting per table; prices always from the server; a UPI payment settles only when a
  cashier with `bill.settle` confirms it.
- Table QR through the order hub (P5-03): the outlet still accepts no connection from the internet. The hub relays guest
  requests down the outlet's own outgoing event stream. The outlet answers only add-on guest paths (`/a/<id>/…`, never
  `/v1`, never the signed package files) and only while that add-on allows it. A relayed request carries the guest's
  address with a per-start secret; a header guessed by someone on the network is ignored. The hub stores no guest data
  and caches only the page and its files, for a minute; only the store the request was sent to may answer it.
- Devices from anywhere (P6-02): the outlet PC opens one outgoing WebSocket to DinePOS Cloud with its device key; the cloud
  sends devices' requests and live streams for `https://<store>.<cloud>` down it. Replayed requests carry a per-start
  secret, so they are never the master PC on loopback: each device needs its own pairing token, and staff their PIN and
  rights, exactly as on the LAN. Only the device's credentials and content headers pass (no cookies); only a fixed list
  of answer headers comes back. Device streams are accepted only from the outlet's own address, the DinePOS terminal
  app or a native client. Caddy makes HTTPS certificates on demand only for addresses the cloud confirms
  (`/v1/tls-ask`). The cloud stores none of this traffic.
- Hosted outlets (P6-04): the outlet's server runs in DinePOS Cloud on 127.0.0.1 with `DINEPOS_TRUST_LOOPBACK=0`, so every
  device pairs and every person signs in. The cloud's own process alone holds the outlet's host key, sent as
  `x-dinepos-host-key` for the owner's first steps from the admin page. That page is protected by the admin key, and
  pairing still needs the owner's PIN. The cloud's proxy strips the header from all outside requests, and an outlet PC
  (no host key configured) ignores it. Licences: one key per hosted outlet (`hostedHardwareId`); the master PC takes no
  seat.

