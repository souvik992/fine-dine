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

## Offline
IndexedDB outbox (`idb` library). Allowed offline: OpenTable, AddItems, Update/RemoveHeldItem, FireKOT
(shown as "queued"). Everything else disabled with a reason.

## Notes
- Service worker caches the app shell and the last menu snapshot.
- Large touch targets (min 48 px), works one-handed, works in Hindi/Bengali (i18n JSON files).
