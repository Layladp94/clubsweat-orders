// Messages that go out after an order is paid / ready. Shared by the
// WhatsApp webhook (pass-paid orders), the Yoco webhook and the bar actions.

import { db, type Customer, type Order } from "./db.ts";
import { optionalEnv, rands } from "./env.ts";
import { formatLines, getLines } from "./orders.ts";
import { senderFor, textOrTemplate } from "./whatsapp.ts";

async function prepMinutes(): Promise<number> {
  const { data } = await db().from("bar_settings").select("prep_minutes").eq("id", 1).single();
  return data?.prep_minutes ?? 6;
}

/** Tell the customer their order is confirmed and alert the bar phone. */
export async function notifyNewOrder(customer: Customer, order: Order, extra?: { remainingCredits?: number | null; low?: boolean }): Promise<void> {
  const lines = await getLines(order.id);
  const summary = formatLines(lines);
  const mins = await prepMinutes();
  const first = (customer.name ?? "").split(" ")[0] || "there";

  let msg = `Thanks ${first}! Order *${order.short_code}* is in.\n\n${summary}\n\n` +
    (order.paid_with === "pass" ? "Paid with your coffee pass." : `Paid ${rands(order.total_cents)}.`) +
    `\n\nReady in about ${mins} minutes. We'll message you when it's at the counter.`;
  if (extra?.remainingCredits !== null && extra?.remainingCredits !== undefined) {
    msg += `\n\nPass balance: ${extra.remainingCredits} coffee${extra.remainingCredits === 1 ? "" : "s"} left.`;
    if (extra.low) msg += " Reply *pass* to top up.";
  }

  const s = senderFor(customer.wa_id, customer.id);
  await textOrTemplate(s, msg, { name: "order_confirmed", params: [first, order.short_code, String(mins)] });

  await alertBar(`NEW ORDER ${order.short_code}\n${customer.name ?? customer.wa_id}\n${summary}\n${order.paid_with === "pass" ? "PASS" : rands(order.total_cents) + " paid"}`,
    [order.short_code, customer.name ?? customer.wa_id, summary.replaceAll("\n", "; ")]);
}

export async function notifyReady(customer: Customer, order: Order): Promise<void> {
  const first = (customer.name ?? "").split(" ")[0] || "there";
  const s = senderFor(customer.wa_id, customer.id, "staff");
  await textOrTemplate(
    s,
    `${first}, order *${order.short_code}* is ready at the counter. Enjoy!`,
    { name: "order_ready", params: [first, order.short_code] },
  );
}

/** Send a plain message to the staff phone. Falls back to the staff template outside the 24h window. */
export async function alertBar(text: string, templateParams: string[]): Promise<void> {
  const phone = optionalEnv("BAR_PHONE");
  if (!phone) return;
  const s = db();
  let { data: bar } = await s.from("customers").select("*").eq("wa_id", phone).maybeSingle();
  if (!bar) {
    const ins = await s.from("customers").insert({ wa_id: phone, name: "Bar phone" }).select("*").single();
    bar = ins.data;
  }
  if (!bar) return;
  const sender = senderFor(phone, bar.id);
  await textOrTemplate(sender, text, { name: "staff_new_order", params: templateParams });
}
