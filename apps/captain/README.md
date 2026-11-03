# @dinepos/captain — waiter app (PWA)

Runs in the phone browser (Chrome on Android) and can be "installed" to the home screen. Built with Vite +
React and served by the outlet server at `/captain`.

Read first: `docs/09-ui-screens.md` (Captain), `docs/05-sync-offline.md`, `docs/03-command-api.md`.

## Screens
1. Connect (master IP or scan QR shown on desktop Settings › Devices) → pairing code
2. PIN login
3. My tables (assigned areas first, derived states, elapsed time)
4. Order: category chips, item list, modifier sheet, held basket with course tags, Fire all / Fire course
5. Request bill, covers, notes
6. Needs attention (offline replays that conflicted)

## Captains (P3-04)
- "My tables" tab (`tablesFor(…, MINE, me)` in `src/tables-model.ts`): my section plus the orders I look after; picked
  once when the floor first loads. OpenTable from the phone names the signed-in captain.
- Request bill in the order footer (`RequestBill` through the outbox, online only); the banner shows when and who.

## Offline (P3-03)
Every change goes through the outbox in `@dinepos/client` (`Outbox`, `orderView`), stored in IndexedDB
(`src/offline/idb.ts`, no extra library). `src/offline/sync-context.tsx` decides each change on the latest view,
replays when the stream is live and every 10 s, keeps the last floor/menu/orders for offline use and shows the
messages. Allowed offline: OpenTable, AddItems, Update/RemoveHeldItem, FireKOT (shown as "queued"); SetCovers needs the
server. Refused replays go to `src/screens/AttentionSheet.tsx`. Details and limits: `docs/05-sync-offline.md`.

## Notes
- Service worker caches the app shell and the last menu snapshot.
- Large touch targets (min 48 px), works one-handed, works in Hindi/Bengali (i18n JSON files).

## Built (P3-01)
- `npm run build -w @dinepos/captain` → `dist/`, served by the server at `/captain` (`apps/server/src/routes/web-apps.ts`;
  in the installer: `resources/server/web/captain`, copied by the server bundle script). `npm run dev -w @dinepos/captain`
  serves it on :5174 with the API proxied to :7420.
- Uses `@dinepos/client` (the same API client and live stream as the desktop terminal), same origin as the server.
- Pairing, PIN sign-in and the stream come from `@dinepos/web-shell` (shared with the kitchen display since P4-02);
  `src/app-context.tsx` only holds the phone's settings (10-minute idle lock, topics).
- `src/app-context.tsx` (device token, sign-in, stream), `src/screens/` (Pair, Login, Tables), `public/sw.js`
  (app shell cache; the offline outbox is P3-03).
- End-to-end test: `apps/desktop/e2e/captain.e2e.test.ts` (a phone-sized window pairs, signs in, seats a table and sees
  a KOT appear live).

## Order taking (P3-02)
- `src/screens/OrderScreen.tsx` (menu, course picker, basket, fire), `OptionsSheet.tsx` (variants, add-ons, note,
  course, qty), `src/components/Sheet.tsx`, `src/use-order-session.ts`.
- `src/order-model.ts` (pure, tested): held lines by course, the Fire buttons, KOT messages.
- Cart rules come from `@dinepos/client` (`addOrMerge`, `changeBy`, `OrderSession`, menu helpers), the same code the
  billing terminal runs.
