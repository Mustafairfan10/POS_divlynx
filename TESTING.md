# Testing Cafe POS

There are two layers of testing: an automated end-to-end run (about 1 minute) and a manual checklist covering every feature and edge case (about 30–40 minutes).

## 0. Start the app

```bash
npm install
npm run build
npx next start -p 3123        # production build, service worker enabled
```

Open http://localhost:3123. To start from a completely clean store, stop the server, delete the `.data/` folder, and clear site data in the browser (DevTools → Application → Storage → **Clear site data**).

- Store access code: `demo`
- PINs: Admin `1234`, Manager `2222`, Cashier `1111`, Kitchen `3333`

> `npm run dev` works for quick checks, but the service worker (offline app loading) only runs in the production build.

## 1. Automated end-to-end test

In a second terminal, with the server from step 0 running:

```bash
npm run test:e2e -- http://localhost:3123
```

It drives a real Edge or Chrome browser through these steps:

- pairing the device
- PIN login
- building an order with modifiers
- editing at checkout (the slip total must change)
- a declined card, then cash
- printing a receipt
- going offline and seating a table
- reconnecting, after which the outbox must drain
- a second phone-sized device logging in as Kitchen and bumping the ticket
- the first device seeing the table turn to **Food ready**

Screenshots go to `.e2e/`. Any failure exits with code 1 and saves `.e2e/FAILED.png`.

## 2. Manual checklist

Use two browser windows to act as two devices: a normal window plus a private/incognito window (each one pairs as its own device). Open DevTools → Network → **Offline** to simulate losing the internet.

### Orders and the register
- [ ] Add an item that has no options. It lands in the order straight away, and its tile shows a count.
- [ ] Add a latte, choose Size and Milk, and add a note. A required group (Size) can't be skipped.
- [ ] Add the same item with the same choices again. The line quantity goes up; no duplicate line appears.
- [ ] Switch between Dine-in, Takeaway and Delivery.
  - Dine-in asks for a table.
  - Delivery asks for name, phone and address and won't send or pay without them.
- [ ] Choose a table that already has an open check. You're offered that check instead of a second one.
- [ ] Apply a 10% discount as Cashier (no approval needed). Then try 25%: the manager PIN prompt appears.
- [ ] Use **More → Hold & start new order**. The held order appears under Orders → Open.

### Kitchen
- [ ] Press **Send**. The ticket appears on the Kitchen screen (also in the other window within about 5 s), and a chime plays.
- [ ] Tap items to tick them, then **Bump**. Check the table on the floor plan turns green ("Food ready").
- [ ] Use **Recently done → Recall**. The ticket comes back.
- [ ] Remove an item that was already sent. It asks for a reason and a manager PIN, and the ticket shows **VOID**.

### Checkout: editing before the receipt
- [ ] Press **Pay**. The checkout slip shows a guest check with suggested tips.
- [ ] Open the **Edit order** tab and change quantities, remove an item, and add a discount. The slip and the amount due update immediately.
- [ ] Use **Add items** to go back to the register, add something, and press Pay again. The slip includes it.
- [ ] Pick a tip of 15%. Both the slip and the amount due change.
- [ ] Use **Split equally 3 ways**. Each payment is pre-filled with one share.

### Payments and failures
- [ ] Card → Charge → **Declined**. Nothing is charged, and the declined attempt is listed and appears in the order history.
- [ ] Cash: tap a quick amount above the total. The change is shown, and the order closes with "Paid in full".
- [ ] Tap **Charge** several times rapidly. Only one payment is recorded.
- [ ] Unlock the paid order (manager PIN) and remove an item. "Customer is owed $X" appears with a **Refund** button.
- [ ] Unlock the paid order and add an item. A balance is due again, and the order reopens.
- [ ] **Void** a payment (manager PIN). The balance comes back.

### Receipts and printing
- [ ] Print the bill, the receipt, a reprint (marked **REPRINT**) and a kitchen ticket.
  - Use "Save as PDF" or a thermal printer.
  - Check the 80 mm and 58 mm widths (Settings → Receipt).
- [ ] Change the header and footer under Settings → Receipt. The live preview updates.

### Cancellations and refunds
- [ ] Cancel an unpaid order. A reason is required, and orders already in the kitchen need a manager PIN. The kitchen shows a CANCELLED stamp.
- [ ] Try to cancel a paid order. You're told to refund first.
- [ ] Orders → open a paid order → **Refund**:
  - by item (partial quantity)
  - by custom amount
  - in full

  Check the receipt stamp (PARTIAL REFUND / REFUNDED) and that Reports → Refunds matches.

### Offline and sync
- [ ] Go **Offline** in DevTools. The amber banner appears.
  - Create an order, send it to the kitchen and take a cash payment.
  - The sync chip shows the pending count.
- [ ] Reload the page while offline. The app still opens, and the data is still there.
- [ ] Go back online. Pending drops to 0 within seconds, and the other window shows the order.
- [ ] Conflict: take both windows offline and edit the **same** open order in each (add different items). Bring both online.
  - Both sets of items survive.
  - A "changed on another device — merged" notice appears.
- [ ] Double payment: take both windows offline and pay the same check in both. Bring both online.
  - The order is flagged **Overpaid / refund due** in Orders.
  - Checkout offers the refund.
- [ ] Offline table duplicates: seat the same table in both windows while offline. After syncing, the table shows "2 checks", and **Merge all checks into one** works.

### Tables and floor plan
- [ ] Seat a free table with a guest count. The matching chairs fill in.
- [ ] **Move table** to another free table.
- [ ] Print a check. The table turns amber ("Check printed").

### Menu, staff and settings (log in as Admin)
- [ ] Mark an item **Sold out**. It greys out on the register and can't be added.
- [ ] Create a category, an item and a modifier group (validation: max ≥ min, at least one option).
- [ ] Add a staff member with a PIN.
  - Duplicate PINs are rejected.
  - You can't deactivate yourself or remove the last admin.
- [ ] Change the tax rate. **New** orders use it; existing orders keep their original rate.
- [ ] Switch Appearance between Dark, Light and System.

### Reports
- [ ] Check that Today's net sales, tax, tips, payment-method totals and refunds match what you rang up.
- [ ] **Print summary** (X/Z report) and **Export CSV**.

### Devices and screen sizes
- [ ] Phone (DevTools device toolbar, about 390 px, or a real phone on the same Wi-Fi at `http://<your-PC-IP>:3123`):
  - the bottom tab bar
  - the "Review order" bar
  - checkout tabs (Payment / Slip / Edit order)
- [ ] Tablet portrait and landscape, and desktop.
- [ ] Install as an app (browser menu → Install / Add to Home Screen).

> On a phone over plain `http://` (not localhost), browsers block service workers and secure-crypto APIs. PIN login still works through a fallback, but test offline loading on `localhost` or on the HTTPS Vercel URL.

## 3. After deploying to Vercel

1. Check `https://<your-app>.vercel.app/api/health`. It should return `"storage":"postgres"` and `"insecureDefaults":false`.
2. Pair two real devices (for example a phone and a laptop) and repeat the **Offline and sync** section across them.
3. Run the automated test against production:

```bash
npm run test:e2e -- https://<your-app>.vercel.app
```

This creates test orders in the live database, so run it before real use or on a staging deployment.
