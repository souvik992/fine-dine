# @dinepos/desktop — billing app (Electron)

The terminal UI for cashiers/managers: floor, billing, settle, split, reports, settings. It is **only a
client** of the outlet server — it never opens the database, even on the master PC.

Read first: `docs/09-ui-screens.md`, `docs/03-command-api.md`, `docs/04-realtime-events.md`,
`docs/05-sync-offline.md` (outbox + conflict UX).

## Stack
Electron 45 main process (no preload yet) · React 19 + Vite 8 + Tailwind 4 (renderer) · TanStack Query for
GETs · a small `api` client that builds command envelopes · types and helpers from `@dinepos/shared`. Zustand
and a preload bridge arrive when the offline outbox needs them (P2-07/P3-03).

## Security (P1-08)
The renderer is our own bundle served on `app://dinepos` with a strict CSP (`script-src 'self'`, connect only
to http/ws). `contextIsolation`, `sandbox`, no `nodeIntegration`, no webviews, no navigation away from the app,
no new windows (https links open in the browser), all permission requests denied, single instance. The
renderer calls the outlet server directly; the server allows the `app://dinepos` origin via CORS and on the
WebSocket upgrade. Verified on Electron 45 against both `127.0.0.1` and a LAN IP.

## Folder plan
```
electron/
  main.ts          window, auto-update (later), settings file, offline outbox file
  preload.ts       expose a minimal, typed bridge (no Node in renderer)
src/
  api/client.ts    sendCommand(type, payload, {orderId, expectedVersion}) with retry + commandId reuse
  api/stream.ts    WS with resumeFrom, heartbeat, reconnect backoff
  api/outbox.ts    offline queue (via preload → main process file)
  screens/Floor/, Order/, Settle/, SplitBill/, Reports/, Settings/, Leakage/
  components/      TableTile, ItemGrid, ModifierSheet, Cart, Keypad, ConflictBanner, HealthDots
  hooks/useKeyboardShortcuts.ts
  theme/tokens.css design tokens from docs/09
```

## Billing screen (P1-09)
`src/billing/`: `menu-model.ts` (quick entry, search, sheet options, checks; pure + tested),
`order-session.ts` (one command at a time on the latest version, silent rebase for safe commands, outside-change
detection; pure + tested), `BillingScreen.tsx`, `ModifierSheet.tsx`, `Cart.tsx`. Line amounts in the cart use
the shared `lineAmount`; totals always come from the server snapshot.

## Bill, settle, day end (P1-10)
F9 Print bill (discount % or ₹ with reason, service charge only if the guest agrees, guest details/GSTIN;
preview from the shared calculator, printed figures from the server). F10 Settle (type the amount received;
c/k/u/d/m/o switch cash/card/UPI/due/complimentary/other; + splits; change shown). Day end is on the floor
header: refuses while tables are open, then asks for counted cash and shows the Z-report summary.

## Sign-in and settings (P2-01)
`src/auth/`: first-run setup, name tiles + PIN pad, manager PIN dialog (the command is resent with the same
`commandId` and `X-Manager-Pin`). The session lives in localStorage `dinepos.session`, is checked against the
server at start, shared by all windows, and locks after 10 idle minutes (or Lock / Ctrl+L).
`src/settings/`: one file per section (Outlet, Floor, Menu, Kitchen, Staff, Terminal) plus `common.tsx`;
`layout-model.ts` holds the layout editor geometry (pure + tested). Sections follow `docs/09-ui-screens.md` §7.

## Stock and menu upload (P2-10, P2-11)
`src/stock/`: `StockScreen.tsx` (tabs), `MaterialsTab`, `PurchasesTab`, `RecipesTab`, `UsageTab`, `StockButton`
(floor header badge) and `common.tsx` (queries, `useStockCommand`). `src/settings/MenuImport.tsx` is the Menu ›
Bulk upload tab (CSV parsed by the shared `parseMenuCsv`). Right-click an item tile in billing to mark it sold out.

## Installer (P1-11)
`npm run dist -w @dinepos/desktop` → `release/DinePOS-Setup-<version>.exe` (+ `release/win-unpacked/`). Steps:
server bundle (`apps/server/scripts/bundle.mjs`: one `server.mjs` + migrations + better-sqlite3 Node-API
prebuild) → desktop build → `scripts/fetch-runtime.mjs` downloads node.exe 24.21.0 into `build-cache/` and checks
its pinned SHA-256 → staged app (bundled main + renderer, no node_modules) → electron-builder NSIS
(`electron-builder.config.cjs`, `build/installer.nsh`) → `scripts/inspect-release.mjs` fails the build if the
archive holds node_modules or `resources/server` misses anything the server needs.

- Per-machine install (admin). Page "Install as master" + "Start with Windows" (both ticked by default; upgrades
  keep the previous choices in `HKLM\Software\DinePOS`). Unattended: `DinePOS-Setup.exe /S /MASTER=1 /AUTOSTART=1`.
- Master: creates `%ProgramData%\DinePOS` (Users: modify), adds **DinePOS Server** shortcuts (Start menu, desktop,
  and Startup when chosen), opens TCP 7420 on private/domain networks, and starts the server as the signed-in user
  (not elevated). The server runs standalone in its own window, like the order hub. The desktop app defaults to
  `http://127.0.0.1:7420`, so it connects with no setup. Terminals: untick master, then enter the master's address
  (shown in the server window) in Settings.
- Uninstall/upgrade: `resources\server\stop-server.ps1` stops only the server running from this folder (a forced
  stop is safe: WAL + synchronous=FULL, stale lock taken over); shortcuts and the firewall rule are removed; data kept.
- Verified without installing: the bundled server on the shipped node.exe (production defaults with no env vars,
  banner, log file), `stop-server.ps1` (stops only its own server, leaves other Node processes, server restarts
  cleanly), full e2e suite against `win-unpacked\DinePOS.exe` + packaged server
  (`DINEPOS_E2E_PACKAGED=1 npm run test:e2e -w @dinepos/desktop`).
- Known gaps: not code-signed (SmartScreen warns; needs a certificate), default Electron icon, no auto-update, no
  mDNS discovery for terminals yet, starts at sign-in rather than at boot.

### Manual acceptance (P1-11) on a test PC or VM, not a live outlet PC
1. Run `DinePOS-Setup-0.1.0.exe`, keep "Install as master" and "Start with Windows" ticked, finish.
2. A "DinePOS Server" window opens showing the addresses; DinePOS opens and the floor says "Live" with no setup.
3. Reboot and sign in. The server window appears by itself; `http://127.0.0.1:7420/v1/health` → `"ok":true`;
   DinePOS shows "Live".
4. From another PC on the LAN: `http://<master-ip>:7420/v1/health` answers (firewall rule).
5. Close the server window → DinePOS shows "Offline"; open "DinePOS Server" from the Start menu → "Live" again.
6. Uninstall → shortcuts gone, `%ProgramData%\DinePOS\dinepos.db` still present.

## Conflict handling
`VERSION_CONFLICT` → if command is "safe" (see `docs/05-sync-offline.md`) resend with the returned
version; otherwise show `ConflictBanner` with what changed and who did it.

## Dev
- `npm run dev -w @dinepos/desktop`: Vite dev server with hot reload + Electron. The server must be running
  (`npm run dev:server`, then `npm run seed -w @dinepos/server` once).
- `npm run start -w @dinepos/desktop`: production build (`dist-renderer/`, `dist-electron/`) and launch.
- Server address: Settings (gear icon) → "Test connection" → "Save and connect". Default `http://127.0.0.1:7420`;
  `DINEPOS_SERVER_URL` preselects one for a session (installer, tests). File → New window (Ctrl+N) opens a
  second window on the same terminal.
- Tests: `npm run test` (unit, from the repo root). `npm run test:e2e -w @dinepos/desktop` builds the app and drives
  the real Electron window against a real server process (needs a desktop session; not run in CI).
- VS Code terminals set `ELECTRON_RUN_AS_NODE=1`; the scripts remove it.
