# ADR-0004: Signed add-ons

Status: accepted (2026-11-05, P5-01)

## Context

Some features ship and install separately from DinePOS. The first is Table QR: guests order from the code on their table. An outlet that does not buy a feature should not carry it. A feature must also be able to ship a fix without a new DinePOS release. Tiffin POS already loads signed add-ons such as ODS (pos-backend `docs/ADDONS.md`). DinePOS uses the same model, adapted to its own rules: single writer, every write a command, and a renderer that only runs scripts from `app://`.

## Decision

An add-on is a folder in `<dataDir>/addons/<id>/` (`C:\ProgramData\DinePOS\addons\<id>` on Windows). It is installed by the add-on's own Windows installer. The folder holds `manifest.json`, `backend.cjs`, and optionally `ui/ui.js`, `ui/ui.css` and guest web files.

**Loading.** At start, `apps/server/src/addons/loader.ts` handles each folder in this order:

1. Checks the Ed25519 signature of the manifest against `ADDON_TRUST_KEYS` (`packages/shared/src/addons.ts`).
2. Checks that the folder name equals the add-on id.
3. Checks that `minPosVersion` is not newer than this DinePOS.
4. Checks the SHA-256 of every listed file and keeps the checked bytes. Only those bytes are used afterwards.
5. Refuses a version older than the highest that ever ran here (`addon_state`).
6. Runs `backend.cjs` with `register(host)`. Its `require` gives Node built-ins only.
7. Applies its database steps once each, all or none, with checksums (`addon_migration`).

Any failure switches that add-on off with a reason, shown in Settings › Add-ons. DinePOS always starts.

**What the host gives the add-on.**

- **Database steps.** They may create and change only `<id>_` tables (`sql-guard.ts`). ATTACH, PRAGMA, triggers and views are refused.
- **Commands.** `host.command()` registers commands named `<CommandPrefix>…`. They run in the normal pipeline: one transaction, idempotency, rights, audit, events. A command can be `internal`, meaning only the add-on's own code may run it, never a client.
- **Reading data.** Outside commands, `host.db` can only read: the statement must be read-only.
- **Running DinePOS commands.** `host.execute()` and `host.executeOnce()` run DinePOS's own commands. `executeOnce` uses a fixed command id: a retry returns the first result, so food is never sent twice.
- **Routes.** `host.route()` registers:
  - staff routes at `/v1/addons/<id>/…`, signed in and checked against the route's right;
  - guest routes at `/a/<id>/api/…`, public and rate-limited per address (`RATE_LIMITED`, 429).
- **Guest pages.** `host.static()` serves package files at `/a/<id>/…` with a strict CSP: own scripts, connections only back to the server.
- **Floor badges.** `host.floorBadges()` adds marks to floor tiles (`FloorTable.badges`). The desktop and captain apps show them.
- **The add-on's own actor.** `host.systemActor()` is the add-on acting with no one signed in. It may use only the rights listed in its signed manifest (`rights`), for example `kot.fire` when guest orders are accepted automatically.

**Through the order hub (P5-03).** An add-on may let guests reach its pages through the order hub
(`host.hubAccess(fn)`, e.g. Table QR with codes pointing at the hub). Phones then open
`<hub>/s/<store>/a/<id>/…`. The hub sends each request down the outlet's existing event stream as a `guest.request`
event, never stored or numbered. The outlet replays it inside the server on `/a/<id>/…` only, with a secret header
carrying the guest's address so rate limits stay per guest, and posts the answer to `POST /v1/pos/relay/:id`. The outlet
keeps the hub connection open while any add-on wants it, even with online orders off. The hub keeps only the page and its
script and style files for a minute, so many guests opening the menu do not each pull them down the restaurant's line.

**Screens.** The terminal asks `GET /v1/addons` which add-ons are on and loads `app://dinepos/addons/<id>/ui.js?server=…`. The Electron main process fetches the manifest and the file from the server's public `/a/<id>/_pkg/…`. It checks the signature itself with the keys built into the app, then serves the file (`apps/desktop/electron/addons.ts`). A server, or anyone on the LAN, cannot make a terminal run unsigned code. The renderer CSP stays `script-src 'self'`.

The add-on's `ui.js`:
- uses the terminal's React through `window.__DINEPOS__`;
- calls `register(id, { nav, settings, overlay })`;
- styles with its own `qr:`-style prefixed utilities, so it never outranks the terminal's classes.

A crashing screen shows a message inside the add-on's area (`AddonBoundary`); the terminal keeps working.

**Signing.**
- The private key is `%USERPROFILE%\.dinepos\addon-signing\private.pem`, created 2026-11-05. It is never in the repository; back it up offline.
- The build (`addons/<id>/scripts/build.mjs`) signs the manifest and verifies the result against the trusted public key.
- If the key leaks, remove it from `ADDON_TRUST_KEYS` and release DinePOS. If it is lost, no update will be trusted until a DinePOS release adds a new key.

## Consequences

- Billing does not depend on any add-on. A broken or tampered add-on is switched off with a reason.
- A signed add-on runs inside the server with full trust: there is no sandbox. The signature, the read-only database outside commands, the table-name guard and the rights list are safety nets, not isolation. A person should review each add-on before it is signed.
- Anti-rollback is kept in the database, so restoring an old backup also restores the old "highest version seen".
- `addon_state` and `addon_migration` are written by the loader at start, outside the command pipeline, like `schema_migrations`. Everything an add-on changes during service goes through commands.
