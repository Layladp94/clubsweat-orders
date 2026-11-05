// Nightly job (called by pg_cron, see migrations/0002_cron.sql):
//   1. expire passes past their end date
//   2. send a renewal reminder + fresh pay link 2 days before expiry
// Protected by the CRON_SECRET header.

import { db, type Customer, type PassProduct } from "../_shared/db.ts";
import { env, rands } from "../_shared/env.ts";
import { createPayment } from "../_shared/orders.ts";
import { senderFor } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const s = db();
  const now = new Date();
  const report = { expired: 0, reminded: 0, errors: 0 };

  // 1. Expire
  const { data: expired } = await s.from("passes")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("expires_at", now.toISOString())
    .select("id");
  report.expired = expired?.length ?? 0;

  // 2. Remind (expiring within the next 2 days, not yet reminded)
  const horizon = new Date(now.getTime() + 2 * 86400_000).toISOString();
  const { data: due } = await s.from("passes")
    .select("*, customers(*), pass_products(*)")
    .eq("status", "active")
    .is("reminder_sent_at", null)
    .lte("expires_at", horizon);

  for (const pass of due ?? []) {
    const c = pass.customers as Customer;
    const product = pass.pass_products as PassProduct;
    if (!c?.opted_in || !product?.active) continue;
    try {
      const pay = await createPayment({ customer: c, purpose: "pass", amountCents: product.price_cents, passProductId: product.id });
      const first = (c.name ?? "").split(" ")[0] || "there";
      const expDate = new Date(pass.expires_at).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
      const sender = senderFor(c.wa_id, c.id);
      // Template "pass_renewal": body {{1}} name, {{2}} product, {{3}} date, {{4}} price; URL button suffix = payment id
      const r = await sender.template("pass_renewal", [first, product.name, expDate, rands(product.price_cents)], pay.id);
      if (r.ok) {
        await s.from("passes").update({ reminder_sent_at: now.toISOString(), renewal_payment_id: pay.id }).eq("id", pass.id);
        report.reminded++;
      } else {
        report.errors++;
      }
    } catch (e) {
      console.error("renewal failed for pass", pass.id, e);
      report.errors++;
    }
  }

  return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
});
