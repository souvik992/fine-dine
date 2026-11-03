# 07 — Security, licensing and backups

Threat model: staff misuse (voids, reprints, discounts), guests or neighbours on shared Wi-Fi, lost
phones, disk failure. Not: nation-state attackers.

## Device pairing
1. New device opens the app → enters master IP (or mDNS) → requests pairing → gets a 6-digit code.
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
`drawer.open`, `cash.move`; Captain orders and firing, PIN for changes to fired items; Kitchen `kds.bump`,
`menu.stock`. `stock.manage` (materials, purchases, wastage, counts, recipes, stock reads; migration 0005) goes to
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
