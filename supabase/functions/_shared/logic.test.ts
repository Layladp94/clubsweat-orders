// Pure-logic tests (no database). Run: npm run test:functions
import { assertEquals, assert } from "jsr:@std/assert@1";
import { parseInbound } from "./whatsapp.ts";
import { verifyYocoSignature } from "./yoco.ts";
import { keywordMatch } from "./ai.ts";
import { formatLines, passCoverage, type Menu } from "./orders.ts";
import type { OrderLine, Pass } from "./db.ts";

Deno.test("parseInbound reads text, button and list replies", () => {
  const body = {
    entry: [{
      changes: [{
        value: {
          contacts: [{ profile: { name: "Jan Smit" } }],
          messages: [
            { from: "27821234567", id: "wamid.1", type: "text", text: { body: "hi" } },
            { from: "27821234567", id: "wamid.2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "checkout", title: "Checkout" } } },
            { from: "27821234567", id: "wamid.3", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "item:abc", title: "Flat white" } } },
            { from: "27821234567", id: "wamid.4", type: "image", image: { id: "x" } },
          ],
        },
      }],
    }],
  };
  const out = parseInbound(body);
  assertEquals(out.length, 4);
  assertEquals(out[0], { ...out[0], waId: "27821234567", name: "Jan Smit", text: "hi", replyId: null });
  assertEquals(out[1].replyId, "checkout");
  assertEquals(out[2].replyId, "item:abc");
  assertEquals(out[3].text, null);
});

Deno.test("verifyYocoSignature accepts a correctly signed payload and rejects a tampered one", async () => {
  const secretBytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = "whsec_" + btoa(String.fromCharCode(...secretBytes));
  const id = "evt_123";
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ id, type: "payment.succeeded", payload: { amount: 3800 } });

  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

  const headers = new Headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sigB64}` });
  assertEquals((await verifyYocoSignature(body, headers, secret)).ok, true);
  assertEquals((await verifyYocoSignature(body.replace("3800", "1"), headers, secret)).ok, false);

  const stale = new Headers(headers); stale.set("webhook-timestamp", String(Number(ts) - 3600));
  assertEquals((await verifyYocoSignature(body, stale, secret)).ok, false);
});

const menu: Menu = {
  categories: [{ id: "c1", name: "Coffee", sort: 1, credit_eligible: true }, { id: "c2", name: "Smoothies", sort: 2, credit_eligible: false }],
  items: [
    { id: "i1", category_id: "c1", name: "Flat white", description: null, price_cents: 3800, active: true, sort: 1 },
    { id: "i2", category_id: "c1", name: "Cappuccino", description: null, price_cents: 3800, active: true, sort: 2 },
    { id: "i3", category_id: "c2", name: "Green machine", description: null, price_cents: 6500, active: true, sort: 1 },
  ],
  groups: [{ id: "g1", category_id: "c1", name: "Milk", prompt: "Which milk?", required: true, sort: 1 }],
  modifiers: [
    { id: "m1", group_id: "g1", name: "Full cream", price_delta_cents: 0, is_default: true, sort: 1 },
    { id: "m2", group_id: "g1", name: "Oat", price_delta_cents: 800, is_default: false, sort: 2 },
  ],
  passProducts: [],
};

Deno.test("keywordMatch finds items, quantities and modifiers", () => {
  const r = keywordMatch("Hi! 2 flat white oat milk and a green machine please", menu);
  assertEquals(r.unclear, false);
  assertEquals(r.lines.length, 2);
  const fw = r.lines.find((l) => l.item_id === "i1")!;
  assertEquals(fw.qty, 2);
  assertEquals(fw.modifiers[0].name, "Oat");
  const gm = r.lines.find((l) => l.item_id === "i3")!;
  assertEquals(gm.qty, 1);
  assert(keywordMatch("what time do you close?", menu).unclear);
});

const line = (over: Partial<OrderLine>): OrderLine => ({
  id: crypto.randomUUID(), order_id: "o", item_id: "i1", item_name: "Flat white", qty: 1, unit_price_cents: 3800,
  modifiers: [], line_total_cents: 3800, credit_eligible: true, paid_by_credit: false, ...over,
});

Deno.test("passCoverage respects credits and the daily rule", () => {
  const lines = [line({}), line({}), line({ credit_eligible: false, item_name: "Green machine" })];
  const credits: Pass = { id: "p", customer_id: "c", product_id: "pp", kind: "credits", credits_remaining: 1, starts_at: "", expires_at: "", last_daily_use: null, status: "active" };
  assertEquals(passCoverage(credits, lines), 1);
  assertEquals(passCoverage({ ...credits, credits_remaining: 5 }, lines), 2);
  const today = new Date().toISOString().slice(0, 10);
  const daily: Pass = { ...credits, kind: "daily", credits_remaining: null, last_daily_use: null };
  assertEquals(passCoverage(daily, lines), 1);
  assertEquals(passCoverage({ ...daily, last_daily_use: today }, lines), 0);
  assertEquals(passCoverage(null, lines), 0);
});

Deno.test("formatLines collapses identical lines", () => {
  const txt = formatLines([
    line({ modifiers: [{ group: "Milk", name: "Oat", price_delta_cents: 800 }] }),
    line({ modifiers: [{ group: "Milk", name: "Oat", price_delta_cents: 800 }] }),
    line({ item_name: "Cappuccino", paid_by_credit: true }),
  ]);
  assertEquals(txt, "2 x Flat white (Oat)\n1 x Cappuccino – pass");
});
