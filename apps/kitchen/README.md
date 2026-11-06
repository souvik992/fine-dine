# @dinepos/kitchen — DinePOS Kitchen (Windows app for a kitchen screen)

The kitchen display (`apps/kds`, served by the outlet server at `/kds`) in its own full-screen window, for a
kitchen PC. Nothing of the display is copied here: the app opens the server's page, so it is always the server's
version.

- First start: a setup page asks for the main PC's address (checked with `GET /v1/health` before it is saved, in
  `%APPDATA%\DinePOS Kitchen\kitchen.json`) and whether to open when Windows starts (on by default).
- Then the display opens full screen (kiosk); pairing and the station are remembered by the page itself, as in a
  browser. The screen does not sleep; the new-ticket chime plays without a tap.
- The window may show only that server's pages and this app's setup page; other links and new windows are refused,
  and every permission request (camera, microphone, location) is denied.
- Server not there (main PC starting, network down): the setup page says why and tries again every 10 s.
- The main PC got a new IP address (P2-15): the app asks the network for its server (UDP probe, matched by server
  id), saves the new address and carries the screen's pairing and station over, so nobody re-pairs or types an
  address. It checks at start and every 15 s while the display is up. The setup page also lists the DinePOS servers it
  found, to pick one with a press. The pairing copy is kept in `kitchen.json` and is only given to the same server.
- Keys: Ctrl+Shift+S setup page · F5 reload · Ctrl+Shift+M minimize (to the taskbar; full screen again when restored) · Ctrl+Shift+Q close.

## Commands
- `npm run start -w @dinepos/kitchen` — run from source (a normal window).
- `npm run dist -w @dinepos/kitchen` — installer: `apps/kitchen/release/DinePOS-Kitchen-Setup-<version>.exe`.
- Tests: `electron/config.test.ts` (address, navigation and pairing-copy rules), `electron/discovery.test.ts`, run with `npm run test`.
