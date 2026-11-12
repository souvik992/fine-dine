# ADR-0008: DinePOS Cloud and the Tiffin order hub become one service, PosiNext Cloud, in its own repository

Status: accepted (2026-11-12). Changes ADR-0005 and ADR-0007 where they say "DinePOS Cloud (`cloud/hub`)".

## Context

Two hubs had grown from the same code: the Tiffin order hub (pos-backend `hub/`: online orders, UrbanPiper, sync,
backups for Tiffin QSR) and DinePOS Cloud (this repository's `cloud/hub`: the same, plus accounts, licences, downloads,
the portal's backend and hosted outlets). Fixes had to be copied between them by hand. The retail products
(PosiNext Grocery, Apparel, Pharmacy) need the same accounts, licences and downloads, and belong in neither repository.

The product owner's decisions (2026-11-12): one hub for every product, in a new repository **posinext-cloud**, named
**PosiNext Cloud**. The Tiffin hub is live, so its stores, devices, orders and UrbanPiper set-up move over without any
change on the shops' side.

## Decision

- The repository **posinext-cloud** holds `hub/` (was `cloud/hub`), `contract/`, `core/`, `outlet-server/` (was
  `cloud/outlet-server`) and `packages/licensing` (was here). This repository no longer has `cloud/` or
  `packages/licensing`; the app keeps its own copy of the licence checks, as before.
- The hub's products are Fine Dine, Tiffin QSR, PosiNext Grocery, Apparel and Pharmacy (accounts, licences, downloads).
- Tests here that use the real hub (Table QR relay, cloud tunnel, the online e2e) find it in a posinext-cloud checkout
  next to this repository, or at `POSINEXT_CLOUD_DIR`; without one they are skipped.
- `npm run bundle:cloud` writes the hosted-outlet server into that checkout's `outlet-server/`; commit it there.
- The Tiffin hub moves in with `hub/deploy/merge-tiffin.sh` in posinext-cloud (dry run, copies of both databases, then
  the import). PosiNext Cloud also answers the Tiffin hub's address (`HUB_EXTRA_DOMAINS`) and still accepts the old
  UrbanPiper header and token, so nothing changes for paired PCs, ordering pages or webhooks.
- A server running DinePOS Cloud becomes PosiNext Cloud when `install.sh` from posinext-cloud is run on it: same data,
  admin key and Caddy sites, new names (`posinext-cloud.service`, `/etc/posinext-cloud.env`, `/var/lib/posinext-cloud`).
- Unchanged on purpose: the app's names (DinePOS), the `x-dinepos-host-key` header and the `DINEPOS_*` settings that
  hosted outlets and paired devices already use.

## Consequences

- A hub fix is made once, in posinext-cloud. Roadmap entries before this date that name `cloud/hub` mean posinext-cloud's
  `hub/`.
- Working on the hub together with this app means having both repositories side by side.
