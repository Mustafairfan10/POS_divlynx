# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Front-of-house staff at a café or small restaurant: cashiers and servers taking orders at the counter or table, managers approving voids/refunds and reading reports, and kitchen staff watching the kitchen display. Used in short, interrupted bursts while talking to a guest, mostly by touch on a counter tablet, sometimes on a phone or desktop.

## Product Purpose

An offline-first point of sale: take dine-in, takeaway and delivery orders, send them to the kitchen, take payment (cash, card via terminal, wallet, split, tips), print receipts and kitchen tickets, and keep every device in the store in sync even with no internet. Success is a sale that is fast to ring up, impossible to lose, and never duplicated.

## Positioning

Local-first: every change lands in the device's own database first and syncs later with conflict-aware merges, so the till keeps working through outages and two devices can work the same check safely.

## Operating Context

- Used all day under mixed light: bright daytime café counters and dim evening service. Both a light and a dark theme are first-class; the system preference picks the default.
- Touch-first on tablets; must also work on phones and desktops, and installs as a PWA.
- Physical companions: 58/80 mm thermal printers (receipts, guest checks, kitchen tickets, X/Z reports), card terminals.
- Staff log in with a 4-digit PIN; roles are Admin, Manager, Cashier, Kitchen.

## Capabilities and Constraints

Register (menu grid, modifiers, order types, hold/resume), Checkout (tips, split, cash/card/wallet, live slip), Orders (open/paid/cancelled, fulfilment steps, voids, refunds, audit history), Kitchen display (live tickets, timers, bump/recall, chime), Tables (floor view, move/merge checks), Menu management (categories, items, modifier groups, 86 toggle), Reports (sales, tax, tips, by hour/staff, CSV), Settings (store, staff, devices, printing).

Stack: Next.js 16, React 19, Tailwind CSS v4, lucide-react icons, Dexie (IndexedDB). Fonts are self-hosted at build time so the UI works offline.

## Brand Commitments

- Store name is user-configured (demo: "Divlynx Cafe"); the product shell is "Cafe POS".
- The floor plan keeps tables drawn as tables with their chairs (confirmed keep).
- The previous "Espresso Bar" look (ambient glows, grain, glass panels, gradient item tiles, wide display face, gold glow) is retired and must not return.

## Evidence on Hand

Demo menu and seed data in `src/client/seed.ts`. No product photography, logos or customer evidence exists; do not fabricate any.

## Product Principles

1. Speed at the counter beats decoration: every common action is one obvious tap.
2. Money and state are never ambiguous: totals, paid/unpaid, sync status and kitchen timing read at a glance.
3. Nothing is lost: offline, retries and conflicts are surfaced calmly, never hidden.
4. One vocabulary across every screen: the same button, field and status look the same everywhere.

## Accessibility & Inclusion

Large touch targets for fast, imprecise taps; legible at arm's length; colour is never the only signal for state (timers, paid/unpaid, sync).
