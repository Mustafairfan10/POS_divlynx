# Cafe POS

An offline-first point of sale for restaurants and cafes. It works on phones, tablets and desktops in any modern browser, can be installed as an app (PWA), keeps working with no internet, and syncs across all of a store's devices.

## Features

| Area | What's included |
|---|---|
| **Orders** | Dine-in (with tables and guest count), takeaway (customer name), delivery (name, phone, address and delivery fee). Item modifiers with required/optional rules, kitchen notes, quantity changes, hold and resume, order notes. |
| **Checkout** | A live checkout slip next to the payment panel. **Edit order** works inside checkout and the slip and amount due update straight away. Tips (presets or custom), equal split bills, cash with quick amounts and change, card/wallet through a terminal confirmation (approved or declined), several payments per order. |
| **Receipts** | Thermal template for 58 mm and 80 mm rolls (also works on A4 or "Save as PDF"). It prints guest checks with suggested tips, receipts with a PAID / PARTIAL / REFUNDED stamp, reprint markers, kitchen tickets, and a scannable Code-39 barcode. |
| **Corrections** | Void items (needs a reason, plus manager PIN once the item is in the kitchen), cancel an order (needs a reason), refund by item, by amount or in full, void a mistaken payment, and unlock a paid order (manager). Every action is written to the order's audit history. |
| **Tracking** | Open / Paid / Cancelled lists with search. Fulfilment steps: in kitchen → ready → served / picked up / out for delivery → delivered. |
| **Kitchen display** | Live tickets with colour-coded timers, tap items to mark them ready, bump and recall, a chime for new tickets, and VOID / CANCELLED alerts. |
| **Tables** | Floor view showing seated / food ready / check printed. Move a check to another table, and merge duplicate checks. |
| **Menu** | Categories, items, reusable modifier groups, and an instant "sold out" (86) toggle. |
| **Reports** | Net/gross sales, discounts, refunds, tax, tips, payment methods, order types, top items, sales by hour and by staff. Print an X/Z report or export CSV. |
| **Staff** | 4-digit PIN login with roles: Admin, Manager, Cashier, Kitchen. Manager approval is requested inline when needed. |

## How offline sync works

```
 Device (browser)                                         Server (Vercel)
 ┌───────────────────────────────┐   push (idempotent)   ┌───────────────────────┐
 │ UI ─▶ IndexedDB + outbox      │ ────────────────────▶ │ /api/sync/push        │
 │      (one atomic transaction) │                       │  version check/merge  │
 │                               │ ◀──────────────────── │ /api/sync/pull        │──▶ Postgres
 │ live queries re-render the UI │   pull (cursor)       │  ordered change feed  │
 └───────────────────────────────┘                       └───────────────────────┘
```

- **Local first.** Every change is written to IndexedDB along with an outbox entry in the same transaction. A crash, a closed tab or a dropped connection cannot lose a sale.
- **No duplicates.** Records use client-generated UUIDs, and each upload carries a unique mutation id. The server records every mutation id, so a retry after a timeout returns the original result instead of writing twice. The UI also blocks double taps, warns when an order is identical to one placed in the last few minutes, and offers to open a table's existing check instead of starting a second one.
- **Conflicts.** Each record has a server version. When a device uploads a change based on an older version, the server merges it instead of overwriting:
  - Order items are merged item by item.
  - Kitchen progress never goes backwards.
  - Voids and cancellations stick.
  - Audit logs and adjustments are combined.
  - Payments are separate records that are only ever added, so two devices taking payment for the same check can never lose one. If that overpays the check, it is flagged with "refund due".
- **Retries.** Sync runs every 5 s, straight after each change, when the connection comes back and when the app is reopened. After failures it backs off from 2 s up to 60 s. Only one browser tab syncs at a time (Web Locks).
- **Server reset.** If the server comes back empty, devices detect it and upload their data again.
- **App shell.** A service worker caches the app so it opens with no internet after the first visit.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

No database setup is needed: without `DATABASE_URL` the server uses an embedded Postgres (PGlite) stored in `.data/`.

1. On first launch, enter store access code `demo`.
2. Log in with a demo PIN: Admin `1234`, Manager `2222`, Cashier `1111`, Kitchen `3333`.
3. Change these PINs under **Settings → Staff**.

End-to-end test (needs Edge or Chrome installed). It runs pairing → order → edit at checkout → declined card → cash → print → offline order → reconnect → second device kitchen bump:

```bash
npm run build && npx next start -p 3123
npm run test:e2e -- http://localhost:3123
```

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (the framework is detected as Next.js).
2. Add a Postgres database. In Vercel → **Storage**, create a **Neon** database and connect it to the project. This sets `DATABASE_URL` automatically. Any Postgres URL works (Supabase, RDS, and so on). Tables are created automatically on the first request.
3. Set these environment variables (see `.env.example`):
   - `STORE_ACCESS_CODE`: the code staff enter once per device.
   - `AUTH_SECRET`: a long random string (`openssl rand -base64 32`).
4. Deploy. Open the URL on each device, enter the access code, and optionally use "Add to Home Screen" / "Install app".
5. Check **Settings → Device & sync**. It should report **Storage: postgres**, and no warning about default secrets.

> Without `DATABASE_URL`, a Vercel deployment falls back to a temporary embedded database. It is fine for a demo, but data does not persist between cold starts. Devices detect this and upload their data again, but use Postgres for production.

## Project layout

```
src/lib/        shared domain: types, totals/tax math, conflict merge, formatting
src/server/     database adapter (pg / PGlite), device auth, sync engine
src/app/api/    health, device registration, sync push/pull
src/client/     IndexedDB schema, repository (writes + outbox), sync loop, session/roles, seed data
src/components/ App shell, UI kit, receipt template, print helper, dialogs
src/components/views/  Register, Checkout, Orders, Tables, Kitchen, Menu, Reports, Settings
```

Money is stored as integer cents throughout. Each order records the tax and service-charge rates in force when it was created, so changing settings never rewrites past orders.
