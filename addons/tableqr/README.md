# Table QR add-on

Guests scan the code on their table and the menu opens on their phone. From there they can:
- order;
- call a waiter;
- ask for the bill;
- see the table's running bill;
- pay a printed bill by UPI.

It is a signed DinePOS add-on (`docs/adr/0004-signed-addons.md`). It is installed with its own installer on the main PC, the one whose DinePOS runs the outlet server.

## What it adds

**Settings › Table QR** (owner):
- Switch it on.
- Choose how orders are accepted:
  - **staff accepts first** (default);
  - **straight to the kitchen**.
- Guest UPI payment. This needs the outlet's UPI ID in Settings › Outlet & bills.
- The address printed in the codes. By default it is the PC's first network address; reserve that address in the router.
- A welcome line for the guest menu.
- Codes per table:
  - **Make missing codes**;
  - **New code** for one table, which stops the old printed one;
  - **Print codes**: an A4 sheet, two codes per row, outlet name and table number.

**Table QR** button on the floor: the guest requests waiting first, then the last 12 hours' handled ones, with who handled each.

**Alerts on every terminal screen:** a corner panel with a chime for each new request. From the panel, staff can:
- accept and send the KOT;
- reject an order with a reason the guest sees;
- mark a waiter call done;
- confirm a UPI payment.

**Marks on the table tiles** (desktop and captain apps):
- **QR order** (red, pulsing);
- **Waiter called** (red, pulsing);
- **Paid? ₹…**, a payment to check (amber).

**The guest page** at `/a/tableqr/?t=<table code>`:
- The menu, with photos and search. Only available dishes appear, and the prices are the server's.
- Sizes and extras with their rules, and a note for the kitchen.
- A cart. The guest gives the number of guests when nobody has seated the table yet.
- **My table** shows:
  - their requests and their state;
  - the running bill with tax;
  - **Call waiter** and **Ask for bill**. Ask for bill marks "Bill asked", the same as a captain's request.
  - Once the bill is printed: **Pay with a UPI app**, which opens the guest's UPI app with the exact amount, and **I have paid**.

## How orders reach the kitchen

Only through DinePOS's own commands (OpenTable, AddItems, FireKOT). They run as the staff member who tapped Accept, or as the add-on's own actor in automatic mode. That actor may use only `order.create`, `order.edit` and `kot.fire`, the rights listed in its signed manifest. Each step of an accept has a command id made from the request, so a retry never sends food twice.

A UPI payment is settled only by a cashier with `bill.settle`, after they confirm the money arrived. The bill is settled as UPI with reference "Table QR".

## Safety

- The table code is 18 random bytes. A new code stops the old one at once.
- The guest API is public but rate-limited per address. Each table can have at most 5 requests waiting.
- The guest page may load only its own files and talk only to the outlet server (CSP).
- **What the codes open** (Settings › Table QR):
  - **the internet, through the order hub** (recommended): works on mobile data. The outlet must be connected to the order
    hub (Settings › Online orders › Order hub); online orders need not be on. The hub only relays: each request goes down
    the outlet's own connection, and nothing about guests or orders is kept on the hub. If the outlet is offline, guests
    are told so.
  - **the outlet Wi-Fi only**: works with no internet; guests must join the Wi-Fi first.
  Changing it changes every code: print them again.

## Build, test, install

```bash
npm run test -w @dinepos/addon-tableqr      # rules + the add-on inside a real DinePOS server
npm run build -w @dinepos/addon-tableqr     # -> addons/dist/packages/tableqr (signed; needs the signing key)
npm run installer -w @dinepos/addon-tableqr # -> addons/dist/installers/DinePOS-TableQR-Setup-<version>.exe
npm run test:e2e -w @dinepos/desktop -- apps/desktop/e2e/tableqr.e2e.test.ts   # the real apps
```

- **Installing:** run `DinePOS-TableQR-Setup-<version>.exe` on the main PC, then close and reopen DinePOS there. It needs administrator rights and an installed DinePOS. It copies the package into `C:\ProgramData\DinePOS\addons\tableqr`.
- **Uninstalling:** use Windows Settings › Apps. The add-on's settings, codes and history stay in the DinePOS data.
- **Releasing:** raise `version` in `package.json` for every release. DinePOS refuses a version older than one it already ran.
