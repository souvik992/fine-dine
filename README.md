# DinePOS — offline-first fine-dine POS (monorepo)

An offline-first restaurant POS for Indian dine-in outlets: table floor view, station-wise KOTs,
move/merge/split, captain (waiter) app, KDS, GST billing, audit/leakage controls.

One Windows PC per outlet runs the **outlet server** (single SQLite writer). Billing terminals,
captain phones and kitchen screens are LAN clients. Cloud is optional and comes later.

> This repo is a **spec + scaffold**. Most code is not written yet. It is designed so you can open it
> in VS Code and let Claude Code implement it phase by phase, using the docs as the source of truth.

---

## 1. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22 LTS | server, desktop, build tooling |
| npm | 10+ | workspaces (npm 11+ may block install scripts: approve `better-sqlite3`/`esbuild` with `npm install-scripts approve <pkg>`) |
| Git | any | version control (Claude Code works best in a git repo) |
| VS Code | latest | editor |
| Claude Code | latest | install the VS Code extension or the `claude` CLI |
| Windows 10/11 | — | target OS for master PC and terminals (dev also works on macOS/Linux) |
| Visual Studio Build Tools (Windows) | 2022 | `better-sqlite3` native build |
| A thermal printer (optional) | 58/80 mm ESC/POS, LAN or USB | real print testing; a fake printer is provided for dev |

## 2. Get started

```bash
git init                      # if you downloaded the zip
npm install                   # installs all workspaces
npm run typecheck             # tsc -b across all workspaces
npm run lint                  # eslint (type-aware, flat config)
npm run test                  # vitest, all workspaces
npm run check                 # all three, same as CI
```

Then open the folder in VS Code and start Claude Code in the repo root.

## 3. How to build this with Claude Code (the easy path)

1. Read `CLAUDE.md` once — it is what Claude reads automatically on every session.
2. Open `docs/10-roadmap.md`. Work top to bottom: Phase 1 → 4. Every task has an ID like `P1-03`.
3. In Claude Code, run the slash command:

   ```
   /implement-task P1-01
   ```

   Claude will read the relevant docs, plan, write code + tests, run them, and tick the task in the roadmap.
4. Review the diff, run the app, commit. Repeat with the next task.

Other helpers (in `.claude/commands/`):

| Command | What it does |
| --- | --- |
| `/implement-task <ID>` | Implement one roadmap task end to end |
| `/add-command <Name>` | Add a new POS command (schema, handler, tests, docs) |
| `/review-task <ID>` | Check a finished task against its acceptance criteria |
| `/status` | Summarise roadmap progress and what to do next |

If you prefer copy-paste prompts, use `prompts/phase-1.md` … `prompts/phase-4.md`.

## 4. Repo layout

```
apps/
  server/      Outlet server: Fastify + WebSocket + better-sqlite3 (the single writer)
  desktop/     Electron billing app (floor view, billing screen, settle, reports)
  captain/     Captain (waiter) PWA served by the outlet server
  kds/         Kitchen display PWA served by the outlet server
packages/
  shared/      Types, zod command/event schemas, money + tax helpers, state derivation
  printing/    ESC/POS rendering + printer transports + fake printer
docs/          Specs — the source of truth (read these before coding)
prompts/       Phase-by-phase prompts for Claude
.claude/       Claude Code slash commands
```

## 5. Docs index

| File | Topic |
| --- | --- |
| `docs/00-overview.md` | Product scope, glossary |
| `docs/01-architecture.md` | Processes, modules, tech stack, single-writer rule |
| `docs/02-domain-model.md` | Entities, table/order/KOT state machines, invariants |
| `docs/03-command-api.md` | Every command: payload, rights, effects, errors |
| `docs/04-realtime-events.md` | WebSocket topics and events |
| `docs/05-sync-offline.md` | Versions, idempotency, client outbox, failover, cloud sync |
| `docs/06-printing-kds.md` | Station routing, ESC/POS templates, retry, KDS |
| `docs/07-security-licensing.md` | Device pairing, PINs, TLS, licence, backups |
| `docs/08-billing-gst.md` | Tax math, rounding, numbering, split bills, service charge |
| `docs/09-ui-screens.md` | Screens and interactions (our own design) |
| `docs/10-roadmap.md` | Phased task list with acceptance criteria |
| `docs/adr/` | Architecture decision records |

## 6. Scripts

| Script | Does |
| --- | --- |
| `npm run dev:server` | Start outlet server on :7420 with a dev DB and fake printers |
| `npm run dev:desktop` | Start Electron app pointing at the local server |
| `npm run test` | Run all unit tests (vitest) |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm run lint` | ESLint |

(The `dev:*` scripts start working once Phase 1 tasks create the entry points.)

## 7. Design note

Workflows are modelled on how Indian fine-dine POS products work in general. The UI, naming,
icons and code in this repo are original — do not copy another vendor's screens, assets or branding.
