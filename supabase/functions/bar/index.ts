// Actions from the barista screen. Requires a signed-in Supabase user (the
// bar login); the gateway verifies the JWT before this code runs.
//
// POST { action: "set_status", order_id, status }   status: making|ready|collected|cancelled
// POST { action: "reply", customer_id, text }
// POST { action: "set_open", is_open, prep_minutes? }

import { db, type Customer, type Order } from "../_shared/db.ts";
import { json } from "../_shared/env.ts";
import { notifyReady } from "../_shared/notify.ts";
import { senderFor } from "../_shared/whatsapp.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return withCors(json({ error: "method not allowed" }, 405));

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return withCors(json({ error: "bad json" }, 400)); }
  const s = db();

  try {
    switch (body.action) {
      case "set_status": {
        const status = String(body.status);
        if (!["making", "ready", "collected", "cancelled"].includes(status)) return withCors(json({ error: "bad status" }, 400));
        const patch: Record<string, unknown> = { status };
        if (status === "ready") patch.ready_at = new Date().toISOString();
        if (status === "collected") patch.collected_at = new Date().toISOString();
        const { data: order, error } = await s.from("orders").update(patch).eq("id", String(body.order_id)).select("*").single();
        if (error) throw error;
        if (status === "ready") {
          const { data: c } = await s.from("customers").select("*").eq("id", order.customer_id).single();
          if (c) await notifyReady(c as Customer, order as Order);
        }
        return withCors(json({ ok: true, order }));
      }
      case "reply": {
        const { data: c } = await s.from("customers").select("*").eq("id", String(body.customer_id)).single();
        if (!c) return withCors(json({ error: "customer not found" }, 404));
        const r = await senderFor(c.wa_id, c.id, "staff").text(String(body.text ?? "").trim());
        if (!r.ok) {
          const hint = r.code === 131047
            ? "The customer hasn't messaged in the last 24 hours, so WhatsApp only allows approved templates. Ask them to message first."
            : r.error;
          return withCors(json({ ok: false, error: hint }, 422));
        }
        return withCors(json({ ok: true }));
      }
      case "set_open": {
        const patch: Record<string, unknown> = { is_open: Boolean(body.is_open), updated_at: new Date().toISOString() };
        if (typeof body.prep_minutes === "number") patch.prep_minutes = body.prep_minutes;
        if (typeof body.closed_message === "string") patch.closed_message = body.closed_message;
        const { error } = await s.from("bar_settings").update(patch).eq("id", 1);
        if (error) throw error;
        return withCors(json({ ok: true }));
      }
      default:
        return withCors(json({ error: "unknown action" }, 400));
    }
  } catch (e) {
    console.error("bar action failed", e);
    return withCors(json({ error: String(e) }, 500));
  }
});

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}
