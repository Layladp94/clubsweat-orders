// Receives Yoco webhook events (payment.succeeded, payment.failed, refund.*).

import { db, firstTimeEvent, type Customer, type Order, type PassProduct } from "../_shared/db.ts";
import { env, rands } from "../_shared/env.ts";
import { notifyNewOrder } from "../_shared/notify.ts";
import { applyPassDeduction, describePass, grantPass, payUrl } from "../_shared/orders.ts";
import { senderFor, textOrTemplate } from "../_shared/whatsapp.ts";
import { verifyYocoSignature, type YocoEvent } from "../_shared/yoco.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();

  const sig = await verifyYocoSignature(raw, req.headers, env("YOCO_WEBHOOK_SECRET"));
  if (!sig.ok) {
    console.error("Yoco signature rejected:", sig.reason);
    return new Response("bad signature", { status: 401 });
  }

  let event: YocoEvent;
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  if (!(await firstTimeEvent("yoco", event.id))) return new Response("duplicate", { status: 200 });

  try {
    if (event.type === "payment.succeeded") await onPaymentSucceeded(event);
    else if (event.type === "payment.failed") await onPaymentFailed(event);
    else console.log("ignored event", event.type);
  } catch (e) {
    console.error("yoco event failed", event.id, e);
    // Still 200: we've recorded the event id; retries would be de-duplicated.
    // Operational errors are visible in the function logs.
  }
  return new Response("ok", { status: 200 });
});

async function findPayment(event: YocoEvent) {
  const s = db();
  const checkoutId = event.payload?.metadata?.checkoutId;
  const paymentId = event.payload?.metadata?.paymentId;
  let q = s.from("payments").select("*");
  if (paymentId) q = q.eq("id", paymentId);
  else if (checkoutId) q = q.eq("checkout_id", checkoutId);
  else return null;
  const { data } = await q.maybeSingle();
  return data;
}

async function onPaymentSucceeded(event: YocoEvent): Promise<void> {
  const s = db();
  const payment = await findPayment(event);
  if (!payment) { console.error("payment not found for event", event.id, event.payload?.metadata); return; }
  if (payment.status === "succeeded") return;
  if (event.payload.amount !== payment.amount_cents) {
    console.error("amount mismatch", payment.id, event.payload.amount, payment.amount_cents);
  }
  await s.from("payments").update({ status: "succeeded", succeeded_at: new Date().toISOString() }).eq("id", payment.id);

  const { data: customer } = await s.from("customers").select("*").eq("id", payment.customer_id).single();
  if (!customer) return;
  const c = customer as Customer;

  if (payment.purpose === "order" && payment.order_id) {
    const { data: order } = await s.from("orders").update({
      status: "paid", paid_with: "yoco", paid_at: new Date().toISOString(),
    }).eq("id", payment.order_id).select("*").single();
    if (!order) return;
    const ded = await applyPassDeduction(order as Order);
    await s.from("customers").update({ last_order_id: order.id, state: { step: "home" } }).eq("id", c.id);
    await notifyNewOrder(c, order as Order, { remainingCredits: ded.remaining, low: ded.low });
    return;
  }

  if (payment.purpose === "pass" && payment.pass_product_id) {
    const { data: product } = await s.from("pass_products").select("*").eq("id", payment.pass_product_id).single();
    if (!product) return;
    const pass = await grantPass(c.id, product as PassProduct, payment.id);
    await s.from("customers").update({ state: { step: "home" } }).eq("id", c.id);
    const first = (c.name ?? "").split(" ")[0] || "there";
    const sender = senderFor(c.wa_id, c.id);
    await textOrTemplate(
      sender,
      `Thanks ${first}, your pass is active!\n\n${describePass(pass, product as PassProduct)}\n\nJust reply *hi* whenever you want a coffee.`,
      { name: "pass_activated", params: [first, (product as PassProduct).name] },
    );
  }
}

async function onPaymentFailed(event: YocoEvent): Promise<void> {
  const s = db();
  const payment = await findPayment(event);
  if (!payment || payment.status === "succeeded") return;
  await s.from("payments").update({ status: "failed" }).eq("id", payment.id);
  const { data: c } = await s.from("customers").select("*").eq("id", payment.customer_id).single();
  if (!c) return;
  const sender = senderFor(c.wa_id, c.id);
  await sender.ctaUrl(
    `That payment of ${rands(payment.amount_cents)} didn't go through. Tap to try again, or reply *cancel*.`,
    "Try again",
    payUrl(payment.id),
  );
}
