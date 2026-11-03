"use client";
import { Fragment } from "react";
import { activeItems, computeTotals, itemLineTotal, summarizePayments } from "@/lib/calc";
import { formatDateTime, formatMoney, METHOD_LABEL, ORDER_TYPE_LABEL } from "@/lib/format";
import type { Order, OrderItem, Payment, Settings } from "@/lib/types";

export type ReceiptKind = "receipt" | "bill" | "kitchen";

export interface ReceiptProps {
  order: Order;
  payments: Payment[];
  settings: Settings;
  kind: ReceiptKind;
  tableName?: string;
  reprint?: boolean;
  /** Kitchen tickets: print only these items (e.g. newly sent ones). */
  items?: OrderItem[];
  printedBy?: string;
}

export function Receipt(props: ReceiptProps) {
  if (props.kind === "kitchen") return <KitchenTicket {...props} />;
  const { order, payments, settings, kind, tableName, reprint } = props;
  const money = (c: number) => formatMoney(c, settings.currency, settings.locale);
  const t = computeTotals(order);
  const pays = payments.filter((p) => !p.deleted && p.status === "approved");
  const sum = summarizePayments(t.total, pays);
  const items = activeItems(order);
  const isBill = kind === "bill";
  const cancelled = order.status === "cancelled";

  let stamp: string | null = null;
  if (cancelled) stamp = "CANCELLED";
  else if (isBill) stamp = sum.paid > 0 ? "PARTIALLY PAID" : null;
  else if (sum.status === "refunded") stamp = "REFUNDED";
  else if (sum.refunded > 0) stamp = "PARTIAL REFUND";
  else if (sum.status === "paid" || sum.status === "overpaid") stamp = "PAID";
  else if (sum.status === "partial") stamp = "PARTIALLY PAID";
  else stamp = "UNPAID";

  const tipBase = t.subtotal - t.discount;

  return (
    <div className={`rcpt w${settings.paperWidth}`}>
      <div className="c">
        <div className="brand">{settings.businessName}</div>
        {settings.address && <div className="sub">{settings.address}</div>}
        {settings.phone && <div className="sub">Tel {settings.phone}</div>}
        {settings.taxId && <div className="sub">Tax ID {settings.taxId}</div>}
        {settings.receiptHeader && <div className="sub" style={{ marginTop: 4, whiteSpace: "pre-line" }}>{settings.receiptHeader}</div>}
        <div className="doc">{isBill ? "Guest Check" : "Receipt"}</div>
        {stamp && <div className="stamp">{stamp}</div>}
        {reprint && <div className="sub" style={{ fontWeight: 700, marginTop: 2 }}>*** REPRINT ***</div>}
      </div>

      <hr />
      <div className="meta">
        <div className="row">
          <span>Order</span>
          <b className="num">#{order.number}</b>
        </div>
        <div className="row">
          <span>Date</span>
          <span>{formatDateTime(order.closedAt && !isBill ? order.closedAt : order.createdAt)}</span>
        </div>
        <div className="row">
          <span>Type</span>
          <span>
            {ORDER_TYPE_LABEL[order.type]}
            {order.type === "dine_in" && tableName ? ` · Table ${tableName}` : ""}
            {order.type === "dine_in" && order.guests ? ` · ${order.guests} guest${order.guests > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <div className="row">
          <span>Served by</span>
          <span>{order.createdBy}</span>
        </div>
        {order.customer.name && (
          <div className="row">
            <span>Customer</span>
            <span>{order.customer.name}</span>
          </div>
        )}
        {order.customer.phone && (
          <div className="row">
            <span>Phone</span>
            <span>{order.customer.phone}</span>
          </div>
        )}
        {order.type === "delivery" && order.customer.address && (
          <div style={{ marginTop: 2 }}>
            <span style={{ color: "#333" }}>Deliver to: </span>
            {order.customer.address}
          </div>
        )}
      </div>

      <hr />
      {items.map((it) => (
        <div className="item" key={it.id}>
          <div className="row">
            <span className="name">
              <span className="qty">{it.qty}×</span>
              {it.name}
            </span>
            <span>{money(itemLineTotal(it))}</span>
          </div>
          {it.qty > 1 && <div className="mod">@ {money(it.basePrice + it.modifiers.reduce((s, m) => s + m.price, 0))} each</div>}
          {it.modifiers.map((m) => (
            <div className="mod row" key={m.optionId}>
              <span>+ {m.name}</span>
              {m.price !== 0 && <span>{money(m.price)}</span>}
            </div>
          ))}
          {it.notes && <div className="note">“{it.notes}”</div>}
        </div>
      ))}
      {items.length === 0 && <div className="c sub">No items</div>}

      <hr />
      <div className="totals">
        <Row label={`Subtotal (${t.itemCount} item${t.itemCount === 1 ? "" : "s"})`} value={money(t.subtotal)} />
        {t.discount > 0 && (
          <Row
            label={`Discount${order.discount?.type === "percent" ? ` ${order.discount.value}%` : ""}${order.discount?.reason ? ` · ${order.discount.reason}` : ""}`}
            value={`−${money(t.discount)}`}
          />
        )}
        {t.serviceCharge > 0 && <Row label={`Service charge ${order.serviceChargeRate}%`} value={money(t.serviceCharge)} />}
        {t.deliveryFee > 0 && <Row label="Delivery fee" value={money(t.deliveryFee)} />}
        {(t.tax > 0 || order.taxRate > 0) && (
          <Row label={order.taxInclusive ? `Incl. tax ${order.taxRate}%` : `Tax ${order.taxRate}%`} value={money(t.tax)} />
        )}
        {t.tip > 0 && <Row label="Tip" value={money(t.tip)} />}
        {(order.adjustments ?? []).map((a) => (
          <Row key={a.id} label={`Credit · ${a.reason}`} value={`−${money(a.amount)}`} />
        ))}
      </div>
      <hr className="solid" />
      <div className="row grand">
        <span>TOTAL</span>
        <span>{money(t.total)}</span>
      </div>

      {pays.length > 0 && (
        <>
          <hr />
          {pays.map((p) => (
            <Fragment key={p.id}>
              <div className="row">
                <span>
                  {p.kind === "refund" ? "Refund · " : ""}
                  {METHOD_LABEL[p.method]}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span>{p.kind === "refund" ? `−${money(p.amount)}` : money(p.amount)}</span>
              </div>
              {p.method === "cash" && p.tendered != null && p.kind === "payment" && p.tendered > p.amount && (
                <div className="row sub" style={{ paddingLeft: 10 }}>
                  <span>Tendered {money(p.tendered)}</span>
                  <span>Change {money(p.change ?? 0)}</span>
                </div>
              )}
            </Fragment>
          ))}
          {sum.balance > 0 && !cancelled && (
            <div className="row due" style={{ marginTop: 4 }}>
              <span>BALANCE DUE</span>
              <span>{money(sum.balance)}</span>
            </div>
          )}
          {sum.balance < 0 && !cancelled && (
            <div className="row due" style={{ marginTop: 4 }}>
              <span>CREDIT DUE</span>
              <span>{money(-sum.balance)}</span>
            </div>
          )}
        </>
      )}

      {isBill && settings.tipsEnabled && t.tip === 0 && tipBase > 0 && settings.tipPresets.length > 0 && (
        <>
          <hr />
          <div className="tipbox">
            <div className="c" style={{ fontWeight: 700, marginBottom: 4 }}>Suggested gratuity</div>
            {settings.tipPresets.map((p) => (
              <div className="row" key={p}>
                <span>{p}% tip</span>
                <span>
                  {money(Math.round((tipBase * p) / 100))} → {money(t.total + Math.round((tipBase * p) / 100))}
                </span>
              </div>
            ))}
            <div className="row" style={{ marginTop: 10 }}>
              <span>Tip</span>
              <span className="writein" />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span>Total</span>
              <span className="writein" />
            </div>
          </div>
        </>
      )}

      {order.cancelled && (
        <>
          <hr />
          <div className="c">
            Cancelled by {order.cancelled.by}: {order.cancelled.reason}
          </div>
        </>
      )}

      <div className="foot">{isBill ? "This is not a receipt.\nPlease pay at the counter or ask your server." : settings.receiptFooter}</div>
      <Barcode value={order.number} />
      <div className="c num sub" style={{ marginTop: 2 }}>
        {order.number}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function KitchenTicket({ order, settings, tableName, items, reprint }: ReceiptProps) {
  const list = items ?? order.items;
  return (
    <div className={`rcpt kitchen w${settings.paperWidth}`}>
      <div className="c">
        <div className="doc" style={{ marginTop: 0 }}>Kitchen ticket{reprint ? " · reprint" : ""}</div>
        <div className="big num">#{order.number}</div>
        <div style={{ fontWeight: 800, fontSize: "1.2em", marginTop: 2 }}>
          {ORDER_TYPE_LABEL[order.type].toUpperCase()}
          {order.type === "dine_in" && tableName ? ` · TABLE ${tableName}` : ""}
        </div>
        {order.customer.name && <div>{order.customer.name}</div>}
        <div className="sub">{formatDateTime(Date.now())} · {order.createdBy}</div>
      </div>
      <hr className="solid" />
      {list.map((it) => (
        <div className={`item${it.voided ? " void" : ""}`} key={it.id}>
          <div className="row">
            <span className="name">
              <span className="qty">{it.qty}×</span>
              {it.name}
              {it.voided && <span className="tag">VOID</span>}
            </span>
          </div>
          {it.modifiers.map((m) => (
            <div className="mod" key={m.optionId}>
              + {m.name}
            </div>
          ))}
          {it.notes && <div className="note">!! {it.notes}</div>}
        </div>
      ))}
      {order.note && (
        <>
          <hr />
          <div style={{ fontWeight: 700 }}>Order note: {order.note}</div>
        </>
      )}
      <hr className="solid" />
    </div>
  );
}

// ------------------------------------------------------------------ Code 39 barcode

const C39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", "*": "nwnnwnwnn",
};

function Barcode({ value }: { value: string }) {
  const text = `*${value.toUpperCase().replace(/[^0-9A-Z-]/g, "")}*`;
  const bars: Array<{ x: number; w: number }> = [];
  let x = 0;
  for (const ch of text) {
    const pat = C39[ch];
    if (!pat) continue;
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === "w" ? 3 : 1;
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    }
    x += 1; // inter-character gap
  }
  return (
    <svg className="barcode" viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="#000" />
      ))}
    </svg>
  );
}
