# DinePOS Print Agent

Prints DinePOS tickets on printers the outlet server cannot reach itself. That happens when:
- the server runs in DinePOS Cloud (P6-04);
- the printers are on another network than the server, for example kitchen printers on the kitchen's own Wi-Fi.

Install it on any Windows PC on the printers' network. It only connects out, over the LAN or through the outlet's DinePOS
Cloud address. It keeps no tickets: the server's print queue owns every job, its retries, the backup printer and the
status light.

## Set up

1. In DinePOS, go to **Settings › Kitchen & printers › Print agents › Add print agent**, name it (for example "Back
   office PC") and copy the key it shows. The key is shown only once, and DinePOS keeps only its hash.
2. On the PC by the printers, run `DinePOS-PrintAgent-Setup-<version>.exe` and enter:
   - the server address: the main PC's LAN address, or the outlet's cloud address from Settings › Cloud sync;
   - the key.

   The installer checks both before it goes on. The agent then starts with Windows (a scheduled task under SYSTEM, so no
   one needs to log in) and is restarted if it stops.
3. In DinePOS, choose the agent under **Printed by** on each printer it should print, then use **Test print**. The
   printer's own settings (network IP and port, or the Windows printer name) are how the *agent* reaches it.

If the agent PC is off, its printers show "Not printing" with the reason, as with any printer, and the backup printer
takes the tickets. Removing the agent in DinePOS stops its key at once and gives its printers back to the server.

## How it talks to the server

- `GET /v1/print-agent/jobs?wait=20000`: the agent's name, its printers and the waiting jobs. This is a long poll; the
  server answers at once when a ticket comes.
- `POST /v1/print-agent/jobs/<jobId>` with `{ ok, error }`: the result of one job.
- Every request carries `Authorization: Agent <key>`. Agents are not paired devices; they have their own key.

## Files on the agent PC

| What | Where |
|---|---|
| Program | `C:\Program Files\DinePOS Print Agent\` (`node.exe`, `agent.mjs`) |
| Settings | `C:\ProgramData\DinePOS Print Agent\agent.json`: the server address and key, readable by SYSTEM and administrators only |
| Log | `C:\ProgramData\DinePOS Print Agent\logs\agent-<date>.log` |
| Check from a command prompt | `"C:\Program Files\DinePOS Print Agent\node.exe" "C:\Program Files\DinePOS Print Agent\agent.mjs" --status` |

## Build

```
npm run dist -w @dinepos/print-agent   # -> apps/print-agent/release/DinePOS-PrintAgent-Setup-<version>.exe
```

This needs `apps/desktop/build-cache/node.exe` and makensis. Building the DinePOS installer once downloads both.
