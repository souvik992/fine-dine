# 00 — Overview

## Product
DinePOS is a Windows-first, offline-first POS for Indian dine-in restaurants (fine dine, casual dining,
bars), extending a QSR billing core with table service.

## Must-have capabilities (v1)
- Areas (dining sections) with their own price list and tax profile
- Floor view of tables with live derived state and elapsed time
- Billing screen: categories, items, variations, add-ons, notes, hold list
- Station-wise KOTs (one ticket per kitchen station), change slips, reprints
- Move table, merge tables, transfer items, split bill (equal / by item / by proportion)
- Print bill, multi-tender settle (cash, card, UPI, due), void with reason
- Roles and per-action rights, manager PIN for sensitive actions
- Append-only audit log and a "leakage" dashboard
- Captain app (PWA) with course-wise firing and offline queue
- KDS per station
- Day-end with Z-report; core reports
- Device-bound licence (owner's keygen)

## Out of scope for v1
Loyalty, aggregator integrations, multi-outlet cloud dashboard (planned Phase 4+). Inventory (materials, purchases,
recipes, wastage, usage report) was added early with P2-10; see docs/02 "Stock".

## Glossary
| Term | Meaning |
| --- | --- |
| Outlet | One restaurant location |
| Master / outlet server | The PC that runs `apps/server` and owns the DB |
| Terminal | A billing PC running `apps/desktop` |
| Captain | Waiter / order taker using `apps/captain` |
| Area | Dining section (Main hall, Terrace, Private room) |
| Order | The running tab of one table (or one takeaway/online order) |
| KOT | Kitchen Order Ticket — what a station must cook; never shows prices |
| Station | Kitchen/bar section with its own printer or KDS (Tandoor, Chinese, Bar) |
| Course | Firing group (1 soups/starters, 2 mains, 3 desserts) |
| Hold | Items added to an order but not yet sent to the kitchen |
| Fire | Send held items to the kitchen as KOTs |
| Bill | Priced, taxed snapshot of an order (one per split part) |
| Tender | One payment line (cash 500, UPI 740) |
| Business date | The trading day; changes at day-end, not midnight |
| Leakage | Signals of possible revenue loss: cancels after fire, reprints, moves, unbilled KOTs |
