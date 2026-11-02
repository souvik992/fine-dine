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

## Installer (P1-11)
`npm run dist -w @dinepos/desktop` → `release/DinePOS-Setup-<version>.exe` (+ `release/win-unpacked/`). Steps:
server bundle (`apps/server/scripts/bundle.mjs`: one `server.mjs` + migrations + better-sqlite3 Node-API
prebuild) → desktop build → `scripts/fetch-runtime.mjs` downloads node.exe 24.21.0 and WinSW 2.12.0 into
`build-cache/` and checks pinned SHA-256s → staged app (bundled main + renderer, no node_modules) →
electron-builder NSIS (`electron-builder.config.cjs`, `build/installer.nsh`) → `scripts/inspect-release.mjs`
fails the build if the archive holds node_modules or `resources/server` misses anything the service needs.

- Per-machine install (admin). Page "Install as master" (ticked by default; upgrades keep the previous choice,
  stored in `HKLM\Software\DinePOS\Master`). Unattended: `DinePOS-Setup.exe /S /MASTER=1` (or `0`).
- Master: creates `%ProgramData%\DinePOS`, installs + starts service `DinePOSServer`, firewall rule "DinePOS
  Server" (TCP 7420, private/domain). The desktop app defaults to `http://127.0.0.1:7420`, so it connects with no
  setup. Terminals: untick master, then enter the master's address in Settings.
- Uninstall: stops and removes the service and the firewall rule; keeps `%ProgramData%\DinePOS`.
- Verified without installing: packaged server on the bundled node.exe (production mode), full e2e suite against
  `win-unpacked\DinePOS.exe` + packaged server (`DINEPOS_E2E_PACKAGED=1 npm run test:e2e …`), WinSW parses the
  service XML. `node scripts/service-dry-run.mjs` runs the server through WinSW `testwait` with a temp data folder
  (needs permission to run WinSW; first attempt failed, cause not yet diagnosed).
- Known gaps: installer and app are not code-signed (SmartScreen warns; needs a certificate), default Electron icon,
  service runs as LocalSystem, no auto-update, no mDNS discovery for terminals yet.

### Manual acceptance (P1-11) on a test PC or VM, not a live outlet PC
1. Run `DinePOS-Setup-0.1.0.exe`, keep "Install as master" ticked, finish (DinePOS opens).
2. The floor shows "Live" without touching Settings; `sc query DinePOSServer` says RUNNING.
3. Reboot. Without signing in to DinePOS: `sc query DinePOSServer` → RUNNING; open
   `http://127.0.0.1:7420/v1/health` → `"ok":true`. Open DinePOS → floor is Live.
4. From another PC on the LAN: `http://<master-ip>:7420/v1/health` answers (firewall rule).
5. Uninstall → service gone (`sc query` fails), `%ProgramData%\DinePOS\dinepos.db` still present.

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
