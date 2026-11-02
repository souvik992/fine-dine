# Changelog

One line per finished roadmap task: `YYYY-MM-DD P1-01 short description`.

- 2026-11-02 P0-00 Scaffold, docs and Claude Code commands created
- 2026-11-02 P1-01 Workspace tooling: package exports, strict tsconfigs (platform-neutral shared), type-aware ESLint flat config, vitest 5 with source aliases, per-workspace test scripts, CI workflow, 0 audit findings
- 2026-11-02 P1-02 Fastify server on :7420 with /v1/health, verified SQLite pragmas, data-dir lock, checksummed migration runner (new 0002_migration_checksums), business-day bootstrap, graceful shutdown
- 2026-11-02 P1-03 Shared money/tax/bill-calc (from Tiffin core): BigInt-safe rounding, largest-remainder allocation, exclusive/inclusive GST, per-line-rate service charge, configurable round-off tie; property tests
- 2026-11-02 P1-04 Command pipeline: shared envelope schema, PosError, executeCommand (IMMEDIATE tx, idempotent replay with request hash, version check, rights hook, audit/event_log/print_job/outbox, post-commit publish), registry, POST /v1/commands, order snapshot query
- 2026-11-02 P1-05 Admin Upsert* commands (area, table, printer, station, category, addon group, menu item), deriveTableState, GET /v1/floor and /v1/menu (price lists, since), idempotent dev seed over HTTP
- 2026-11-02 P1-06 OpenTable, AddItems, UpdateHeldItem, RemoveHeldItem, FireKOT: snapshots + area prices, addon min/max, station routing, per-day KOT numbers, KOT template (ESC/POS + preview) and print jobs, table.state events
- 2026-11-02 P1-07 Bill template (58/80 mm, GST groups, UPI QR), TCP/Windows-spooler/fake transports, durable per-printer print queue with backoff, print.status, backup reroute, GET /v1/printers
- 2026-11-02 P1-08 WebSocket hub (/v1/stream: hello, replay, resync, heartbeat, origin check) + CORS; Electron desktop shell (locked-down app://, React 19), server settings, live Floor screen with seat dialog; e2e: two windows in sync in ~100 ms
- 2026-11-02 P1-09 Billing screen: quick-entry short codes, item grid, modifier sheet with hotkeys, held/fired cart, F8 fire, order command queue with silent rebase, GET /v1/orders/:id; keyboard-only e2e
- 2026-11-02 P1-10 PrintBill (gap-free FY numbers by print date, supersede re-issue, bill_document revisions), Settle (multi-tender, change), DayEnd + Z-report, SetConfig, migration 0003 immutability triggers; desktop F9/F10/Day end
- 2026-11-02 P1-11 (built, acceptance pending) Server bundle, pinned node.exe + WinSW, Windows service definition, NSIS installer with "Install as master", release inspection, packaged e2e, CI installer artifact
- 2026-11-02 P1-11 (change) Server runs standalone like the order hub: DinePOS Server shortcut + start with Windows, banner with LAN address, file logs, production defaults in the bundle; Windows service (WinSW) removed; `npm start` at the root
- 2026-11-02 P2-01 Users, roles and rights: first-run setup, name + PIN sign-in with lockout, sessions, manager-PIN approval, role discount limits, default roles (migration 0004), desktop setup/sign-in/lock screens
- 2026-11-02 P2-01 (setup modules) Settings: outlet & bills, floor & tables with drag-and-drop layout editor, menu (items, categories, add-on groups), kitchen stations & printers with test print (PrintTestPage), staff & roles; GET /v1/admin/catalog; floor Layout view; seed layout spacing fix
- 2026-11-02 P2-10 Stock (from Tiffin): materials, purchases (immutable, void), wastage/count/correction, recipes per item/variant/add-on used at KOT fire (ADR-0003), usage report + CSV, stock.manage right (migration 0005), Stock screen with low-stock badge
- 2026-11-02 P2-11 Menu bulk upload (CSV template, row checks, ImportMenu all-or-nothing) and SetItemAvailability: right-click a billing tile to mark it sold out
