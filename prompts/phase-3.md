# Phase 3 prompts — captain app

## P3-01
Implement P3-01: apps/captain as a Vite + React PWA, built output served by the server at /captain. Connect
screen (IP or QR), pairing, PIN login, My tables list from GET /v1/floor with live updates.

## P3-02
Implement P3-02: captain order screen — category chips, items, modifier sheet, held basket with course tags,
Fire all / Fire course N. Large touch targets, one-handed use.

## P3-03
Implement P3-03: IndexedDB outbox with the offline rules in docs/05-sync-offline.md, replay on reconnect with
the same commandIds, "Needs attention" list for conflicts. Test with the server stopped mid-order.

## P3-04
Implement P3-04: assign captains to areas/tables (desktop settings), filter My tables, Request bill
notification to desktops.

## P3-05
Implement P3-05: captain performance report (orders, covers, sales, items, cancels per captain per day).
