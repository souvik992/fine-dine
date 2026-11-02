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

## Rights
Roles: Owner, Manager, Cashier, Captain, Kitchen (defaults, editable). Rights are strings like
`kot.cancel`; each right has `allowed` and `needsPin` per role. Discount limit (%) per role.

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
