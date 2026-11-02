# 07 — Security, licensing and backups

Threat model: staff misuse (voids, reprints, discounts), guests or neighbours on shared Wi-Fi, lost
phones, disk failure. Not: nation-state attackers.

## Device pairing
1. New device opens the app → enters master IP (or mDNS) → requests pairing → gets a 6-digit code.
2. Manager approves in Settings › Devices on the master/desktop (PIN required).
3. Server issues a 256-bit random device token, stores SHA-256 hash, device name, kind (terminal/captain/kds).
4. Every HTTP/WS call carries the token. Revoke = delete row → immediate 401.

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
`menu.stock`. A PrintBill discount above the role limit needs a manager PIN and is a leakage flag. Safety rules: the
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

## Logging
Rotating JSON logs in `logs/` (pino). Never log PINs, tokens or full customer phone numbers.
