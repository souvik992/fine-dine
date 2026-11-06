# ADR-0005: DinePOS Cloud

Status: accepted (2026-11-07). P6-01 to P6-04 built.

## Context

Until now DinePOS used the Tiffin POS order hub (pos-backend `hub/`) for website orders, sales sync, licences, backups
and the Table QR relay. The owner wants a cloud service for DinePOS only:
- its own AWS server and data;
- devices (terminals, captain phones, kitchen screens) that can connect from anywhere;
- outlets that can run fully in the cloud, with no master PC.

## Decision

1. **A separate service in this repository: `cloud/hub`** (with `cloud/contract` and `cloud/core`). It starts as a copy
   of the Tiffin hub, rebranded:
   - the service, user, folders and commands are `dinepos-cloud`;
   - the installer downloads this repository;
   - the UrbanPiper header is `x-dinepos-token`.

   It keeps:
   - website orders;
   - Swiggy and Zomato through UrbanPiper;
   - sales sync, licence renewals and backups;
   - the Table QR relay;
   - the website builder.

   The two services now evolve separately; a fix in one is copied to the other by hand. It runs on Node 24 with
   `node:sqlite` and has no runtime dependencies, so a small EC2 instance is enough.
   DinePOS talks to it with the same contract as before. An outlet moves by connecting to the new address in
   Settings › Online orders › Order hub.

2. **Two ways to run an outlet, chosen per outlet:**
   - **Relay (P6-02, built):** the outlet PC stays the master and the only database (ADR-0001), and billing keeps working
     on the LAN without internet. Devices outside the LAN reach it at `https://<store>.<cloud>`. The PC keeps one
     outgoing WebSocket to `<cloud>/v1/pos/tunnel` (`apps/server/src/cloud/tunnel.ts`, `cloud/hub/src/tunnel.ts`). Device
     HTTP requests are replayed inside the server, and their live streams are attached to the realtime hub through a
     virtual socket. The outlet never accepts incoming connections. Device pairing, sessions and rights stay exactly as
     on the LAN, and a replayed request is never the trusted master PC. The cloud keeps zero runtime dependencies,
     including its own small WebSocket server (`cloud/hub/src/ws.ts`).
   - **Hosted (P6-04, built):** the DinePOS server runs inside the cloud, one database per outlet with one writer per
     outlet, and devices point at the cloud address. This needs internet at the outlet; there is no offline billing in
     this mode, and the owner chooses it knowing that.
     - **Process:** the cloud (`cloud/hub/src/hosted.ts`) runs the server bundle `cloud/outlet-server` (built with
       `npm run bundle:cloud -w @dinepos/server` and committed, so the cloud only pulls) once per hosted outlet on
       127.0.0.1. It restarts a server that stops, and proxies the outlet's address to it (HTTP and the live stream).
     - **Trust:** the outlet server trusts nobody on loopback (`DINEPOS_TRUST_LOOPBACK=0`). Only the cloud process holds
       the outlet's host key (`DINEPOS_HOST_KEY`, `x-dinepos-host-key`), which acts as the master device for the
       owner's first steps on the admin page: setting up the outlet and approving the first device with the owner's
       PIN. The proxy strips that header from every outside request.
     - **Licence:** the master PC takes no licence seat. Each hosted outlet has its own hardware id: the machine's
       identifiers plus the outlet id, so one cloud machine needs one key per outlet.

3. **Cloud printing (P6-03, built):** KOT and bill printers stay on the outlet LAN. A small print agent at the outlet
   (`apps/print-agent`, a Windows installer with no Electron) asks the server for the tickets of its printers and prints
   them. It works for a hosted server and for a relay outlet whose master PC is not on the printers' network. The agent
   is not a paired device: it has its own key, made on the terminal, of which only the hash is stored. This needs new
   tables only; the device and printer tables are unchanged.

## Consequences

- DinePOS and Tiffin no longer share a hub. DinePOS Cloud can change for fine dining without affecting Tiffin shops.
- The relay keeps every rule of the offline-first design: the cloud holds no outlet data in relay mode.
- Hosted mode is a deliberate exception to "the outlet PC is the single writer". There is still exactly one writer per
  outlet database, but it is in the cloud, and losing internet stops billing there.
