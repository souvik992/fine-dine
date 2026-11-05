# 01 — Architecture

## Topology
```
            LAN / Wi-Fi                         (optional, Phase 4)
 ┌──────────────┐   HTTP+WS   ┌──────────────────────────┐   HTTPS   ┌─────────┐
 │ Desktop app  │────────────▶│  Outlet server (master)  │──────────▶│  Cloud  │
 │ (Electron)   │◀────────────│  apps/server             │◀──────────│ relay + │
 └──────────────┘             │  • SQLite (single writer)│           │ reports │
 ┌──────────────┐             │  • HTTP + WS API         │           └─────────┘
 │ Captain PWA  │────────────▶│  • Print service         │──▶ ESC/POS printers
 └──────────────┘             │  • Sync agent, backups   │    (TCP 9100 / USB)
 ┌──────────────┐             └──────────────────────────┘
 │ KDS PWA      │────────────▶
 └──────────────┘
```

## The single-writer rule (ADR-0001)
Only the server process opens the SQLite file. SQLite WAL mode requires all processes to be on one host and
serialises writers; putting the file on a shared folder for terminals risks corruption. Every other device
is a client of the server's API. The desktop app on the master PC is also just a client (it calls
`http://127.0.0.1:7420`).

## Tech stack
| Concern | Choice |
| --- | --- |
| Language | TypeScript (strict), Node 22 LTS, ESM |
| HTTP | Fastify 5 |
| WebSocket | `ws` (via `@fastify/websocket`) |
| DB | SQLite via `better-sqlite3`, WAL, `synchronous=FULL` |
| Validation | `zod` (shared schemas) |
| IDs | `ulid` |
| Desktop UI | Electron + React + Vite (renderer), no DB access in renderer |
| Captain / KDS | React PWA built with Vite, served as static files by the server |
| Printing | `packages/printing` (own ESC/POS builder; may wrap `node-thermal-printer`) |
| Tests | vitest |
| Windows service | `node-windows` or NSSM wrapper (P1-11) |
| Packaging | electron-builder (NSIS installer) |

## Server modules (`apps/server/src`)
| Folder | Responsibility |
| --- | --- |
| `db/` | connection, pragmas, migration runner, `migrations/NNNN_name.sql` |
| `commands/` | one handler per command + `registry.ts` |
| `core/` | `executeCommand()` pipeline: idempotency, version, rights, tx, audit, post-commit hooks |
| `queries/` | read models: floor, order, menu, reports |
| `routes/` | Fastify routes only (thin) |
| `realtime/` | WS hub, topics, `event_log` replay |
| `print/` | print queue worker(s), printer registry |
| `auth/` | device pairing, user sessions, PIN checks, rights |
| `license/` | licence verification, seat counting |
| `backup/` | scheduled online backups |
| `sync/` | cloud outbox drain (Phase 4) |

## Command pipeline
```
POST /v1/commands
  → zod-validate envelope + payload (shared schema for that type)
  → auth: device token + user session
  → db.transaction(IMMEDIATE):
       if processed_command has commandId → return stored result (DUPLICATE)
       load aggregate (order) → check expectedVersion
       check rights (+ manager PIN when required)
       handler.apply(ctx)  → writes rows, returns { result, events[], printJobs[], auditEntries[] }
       bump order.version; insert audit_event, event_log, print_job, outbox rows
       insert processed_command
  → after commit: realtime.publish(events); printQueue.wake(printerIds)
  → 200 { ok: true, order: snapshot, version }
```

## Add-ons (P5-01, ADR-0004)
Separately installed, signed modules in `<dataDir>/addons/<id>/` (first: Table QR). The server checks each one at start
(signature, folder, version, every file) and runs it inside itself: own `<id>_` tables, own commands through the same
pipeline, staff routes under `/v1/addons/<id>`, public guest pages and API under `/a/<id>`, marks on floor tiles. A
failing add-on is switched off with a reason; DinePOS always starts. Terminals load an add-on's screens only after
checking the same signature themselves. Code: `apps/server/src/addons/`, `apps/desktop/electron/addons.ts`,
`apps/desktop/src/addons/runtime.tsx`, `addons/<id>/`.

## Ports and discovery
- Server listens on `0.0.0.0:7420` (configurable). Static IP recommended for the master.
- mDNS advertisement `_dinepos._tcp` as a convenience; clients also accept a typed IP.
- Captain and KDS PWAs are served at `/captain` and `/kds`.

## Data directory (master)
`%ProgramData%\DinePOS\` → `dinepos.db`, `backups\`, `logs\`, `prints\`, `config.json`, `license.key`.

## Running the server on the master (P1-11)
Decided 2026-11-02 by the product owner: the server runs as a **standalone local process, like the Tiffin order
hub**, not as a Windows service. The installer's "Install as master" option adds a **DinePOS Server** shortcut
(Start menu + desktop) that opens the bundled server (`resources\server\node.exe server.mjs`, Node 24.21.0) in its
own window: production settings by default, data in `%ProgramData%\DinePOS`, JSON logs in
`%ProgramData%\DinePOS\logs\server-<date>.log`, a start-up banner with the LAN address for terminals. Closing the
window or Ctrl+C stops it cleanly. "Start with Windows" puts the shortcut in the all-users Startup folder, so the
server starts when someone signs in (not before sign-in, which only a service could do). Firewall: inbound TCP 7420
on private/domain profiles only. Users get modify rights on the data folder. Uninstall stops the server and removes
shortcuts and the rule, never the data folder. Developers run it with `npm start` (bundle) or `npm run dev:server`.
