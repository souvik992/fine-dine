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

## Ports and discovery
- Server listens on `0.0.0.0:7420` (configurable). Static IP recommended for the master.
- mDNS advertisement `_dinepos._tcp` as a convenience; clients also accept a typed IP.
- Captain and KDS PWAs are served at `/captain` and `/kds`.

## Data directory (master)
`%ProgramData%\DinePOS\` → `dinepos.db`, `backups\`, `logs\`, `config.json`, `license.key`.
