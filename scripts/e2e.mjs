// End-to-end smoke test: drives a real browser through setup → order → edit at checkout →
// payment → offline order → reconnect & sync → kitchen → receipt print.
// Usage: node scripts/e2e.mjs [baseUrl] [outDir]   (needs Edge or Chrome installed)
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3123";
const OUT = process.argv[3] ?? path.join(process.cwd(), ".e2e");
fs.mkdirSync(OUT, { recursive: true });
const CANDIDATES = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 0;
const log = (m) => console.log(`✔ ${++step}. ${m}`);

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.setViewport({ width: 1366, height: 860 });

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const click = async (text, p = page) => {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    for (const el of await p.$$(`::-p-text(${text})`)) {
      if (await el.isVisible()) {
        await el.click();
        await sleep(250);
        return;
      }
    }
    await sleep(150);
  }
  throw new Error(`No visible element with text "${text}"`);
};
const textOf = () => page.evaluate(() => document.body.innerText);
const expectText = async (t, timeout = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await textOf()).toLowerCase().includes(t.toLowerCase())) return;
    await sleep(150);
  }
  throw new Error(`Expected to see "${t}"`);
};

try {
  // 1. Setup
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await expectText("Set up this device");
  await page.type('input[type="password"]', "demo");
  const inputs = await page.$$("input");
  await inputs[2].type("Divlynx Cafe");
  await shot("01-setup");
  await click("Connect device");
  await expectText("Enter your PIN", 15000);
  await shot("02-login");
  log("Device paired with store and demo data seeded");

  // 2. Login as cashier
  await page.keyboard.type("1111");
  await expectText("Open orders", 10000);
  log("Cashier logged in with PIN");

  // 3. Build an order
  await click("Caffè Latte");
  await expectText("Milk");
  await click("Oat");
  await click("Large");
  await shot("03-item-modal");
  await click("Add ·");
  await click("Butter Croissant");
  await click("Butter Croissant");
  await expectText("-001");
  await shot("04-register");
  log("Order #X-001 created with modifiers; repeated item merged into one line");

  // 4. Checkout, then edit order at checkout
  await click("Pay");
  await sleep(600);
  if ((await textOf()).includes("Possible duplicate order")) {
    await shot("04b-duplicate-guard");
    await click("a new order");
    log("Duplicate-order guard fired (identical order from another device) and was acknowledged");
  }
  await expectText("Amount due");
  const before = await page.evaluate(() => document.querySelector(".rcpt .grand")?.textContent);
  await shot("05-checkout");
  await click("Edit order");
  await expectText("Adjustments");
  const plus = await page.$$('button[aria-label="Increase quantity"]');
  await plus[0].click();
  await sleep(500);
  await click("Checkout slip");
  const after = await page.evaluate(() => document.querySelector(".rcpt .grand")?.textContent);
  if (before === after) throw new Error(`Slip total did not update after edit (${before})`);
  await shot("06-checkout-edited");
  log(`Edited at checkout; slip total updated ${before?.replace("TOTAL", "")} → ${after?.replace("TOTAL", "")}`);

  // 5. Card decline then cash payment
  await page.evaluate(() => [...document.querySelectorAll("button.h-20")].find((b) => b.textContent.trim() === "Card")?.click());
  await sleep(200);
  await click("Charge");
  await expectText("Charge on terminal");
  await shot("07-terminal");
  await click("Declined");
  await expectText("Payment declined");
  await sleep(700);
  await page.evaluate(() => [...document.querySelectorAll("button.h-20")].find((b) => b.textContent.trim() === "Cash")?.click());
  await page.waitForSelector('input[placeholder="Other amount"]', { timeout: 5000 });
  const quick = await page.$$("::-p-text(Exact)");
  await quick[0]?.click();
  const tender = await page.$('input[placeholder="Other amount"]');
  await tender.click({ clickCount: 3 });
  await tender.type("50");
  await click("Take cash");
  await expectText("Paid in full");
  await shot("08-paid");
  log("Card decline recorded, cash payment with change completed; order closed");

  // 6. Print receipt (capture print DOM)
  await page.evaluate(() => {
    window.__printed = [];
    window.print = () => window.__printed.push(document.getElementById("print-root")?.innerHTML ?? "");
  });
  await click("Print receipt");
  await sleep(400);
  const printed = await page.evaluate(() => window.__printed[0] ?? "");
  if (!printed.includes("PAID")) throw new Error("Printed receipt missing PAID stamp");
  const rp = await browser.newPage();
  await rp.setViewport({ width: 360, height: 900, deviceScaleFactor: 2 });
  const css = await page.evaluate(() => [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n"));
  await rp.setContent(`<html><head><style>${css}</style></head><body style="background:#fff;margin:0">${printed}</body></html>`);
  await rp.screenshot({ path: path.join(OUT, "09-printed-receipt.png"), fullPage: true });
  await rp.close();
  log("Receipt printed (thermal template captured)");

  // 7. Go offline: seat a table and send an order
  await click("Done");
  await page.setOfflineMode(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await click("Tables");
  await expectText("occupied");
  await click("T3");
  await click("Start order");
  await click("Classic Burger");
  await click("Add ·");
  await click("Send");
  await expectText("Sent 1 item", 8000);
  await expectText("Offline");
  await shot("10-offline-order");
  const pendingOffline = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("pos-db");
    r.onsuccess = () => { const tx = r.result.transaction("outbox"); const c = tx.objectStore("outbox").count(); c.onsuccess = () => res(c.result); };
  }));
  if (!pendingOffline) throw new Error("Expected pending changes in outbox while offline");
  log(`Offline: dine-in order saved locally, ${pendingOffline} change(s) queued`);

  // 8. Reconnect → auto sync
  await page.setOfflineMode(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const start = Date.now();
  let pending = pendingOffline;
  while (Date.now() - start < 20000) {
    pending = await page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("pos-db");
      r.onsuccess = () => { const c = r.result.transaction("outbox").objectStore("outbox").count(); c.onsuccess = () => res(c.result); };
    }));
    if (!pending) break;
    await sleep(500);
  }
  if (pending) throw new Error(`Outbox not drained after reconnect (${pending} left)`);
  log("Back online: outbox drained automatically");

  // 9. A second device sees the data
  const ctx2 = await browser.createBrowserContext();
  const p2 = await ctx2.newPage();
  await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p2.goto(BASE, { waitUntil: "networkidle0" });
  await p2.type('input[type="password"]', "demo");
  await click("Connect device", p2);
  await p2.waitForSelector("::-p-text(Enter your PIN)", { timeout: 20000 });
  await p2.keyboard.type("3333"); // kitchen
  await p2.waitForSelector("::-p-text(Classic Burger)", { timeout: 20000 });
  await sleep(500);
  await p2.screenshot({ path: path.join(OUT, "11-device2-kitchen-mobile.png") });
  log("Second device (phone, kitchen role) paired and sees the burger ticket");

  // Kitchen bumps on device 2 → device 1 sees "Food ready" on the table
  await click("Bump", p2);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await click("Tables");
  await expectText("Food ready", 25000);
  await shot("12-table-food-ready");
  log("Kitchen bump on device 2 synced to device 1 (table shows Food ready)");

  // 10. Orders & reports screens, mobile register
  await click("Orders");
  await shot("13-orders");
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(800);
  await shot("14-mobile-orders");
  log("Orders view + mobile layout rendered");

  if (errors.length) console.log("\nBrowser console errors:\n - " + errors.join("\n - "));
  console.log(`\nAll steps passed. Screenshots in ${OUT}`);
} catch (e) {
  await shot("FAILED");
  console.error("✖ FAILED:", e.message);
  if (errors.length) console.log("Browser console errors:\n - " + errors.join("\n - "));
  process.exitCode = 1;
} finally {
  await browser.close();
}
