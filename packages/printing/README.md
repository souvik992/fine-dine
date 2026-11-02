# @dinepos/printing

Renders KOTs, bills and Z-reports to ESC/POS bytes **and** a plain-text preview, and sends bytes to
printers. Read `docs/06-printing-kds.md` first.

## Contents (to build)
| File | What |
| --- | --- |
| `src/escpos.ts` | small builder: init, bold, size, line, twoCol, wrapped, center, rule, feed, cut, drawerKick; records the text `preview` (P1-06). Raster image in P1-07 |
| `src/layout.ts` | column helpers for 32/48 cols (left/right pad, wrap long item names) |
| `src/bitmap-text.ts` | render a line of Devanagari/Bengali text to a 1-bit raster (via `@napi-rs/canvas`) |
| `src/templates/kot.ts` | `renderKot(kot, opts)` → `{ bytes, preview }` incl. modify/cancel/move/duplicate variants (built in P1-06; text only, bitmap lines in P1-07) |
| `src/templates/bill.ts` | `renderBill(doc, opts)` incl. split part, UPI QR, duplicate, IGST (P1-07) |
| `src/templates/zreport.ts` | `renderZReport(data)` |
| `src/transports/tcp.ts` | send to host:9100; done when flushed and not reset within 1.5 s; 5 s timeout |
| `src/transports/usb-windows.ts` | RAW to a named Windows printer (stub elsewhere) |
| `src/transports/fake.ts` | write preview to `data/prints/<printerId>/<jobId>.txt` |
| `src/layout.ts` | `money`, `percent`, `halfPercent`, `plainRupees` (integer in, text out) |

## Tests
Snapshot tests on `preview` text for every template at 58 and 80 mm. Byte-level tests only for the builder.
