# Phase 2 prompts — bill operations, multi-terminal, rights

## P2-01
Implement P2-01: users, roles, role_permission, PIN login (Argon2id), sessions, requireRight with needs_pin,
manager PIN via X-Manager-Pin, lockout after 5 failures. Seed default roles from docs/07-security-licensing.md.
Replace the allow-all rights stub. Tests for FORBIDDEN and PIN_REQUIRED on every command that has them.

## P2-02
Implement P2-02: device pairing flow (6-digit code, manager approval, token issued and hashed), Authorization
header on HTTP and WS, revoke. Settings › Devices screen in desktop.

## P2-03
Implement P2-03: MoveTable, MergeTables, TransferItems per docs/03-command-api.md and docs/02-domain-model.md.
Keep KOT history, print move notices, set leakage flags. Floor context menu in desktop.

## P2-04
Implement P2-04: ModifyFiredItem, CancelFiredItem, ReprintKOT, ReprintBill with delta/duplicate slips, reasons,
PIN rules and leakage flags.

## P2-05
Implement P2-05: SplitBill (equal, items, proportion) per docs/08-billing-gst.md with a property test
(1,000 random orders, Σ parts = total, each part's tax recomputed correctly). Split dialog in desktop.

## P2-06
Implement P2-06: VoidBill (reversal, keeps number), PayIn, PayOut, OpenDrawer, and their audit/leakage.

## P2-07
Implement P2-07: run a second desktop terminal against the same server; implement the conflict policy table
in docs/05-sync-offline.md (silent rebase vs ask). Write an integration test that fires two clients at one order.

## P2-08
Implement P2-08: scheduled online backups with retention, day-end backup, restore flow with owner PIN.

## P2-09
Implement P2-09: licence verification (Ed25519 public key in app), hardware id, expiry warnings, grace,
block new business date after grace, seat limits at pairing. Add a dev-only test key pair under
apps/server/test-fixtures (never the real private key).
