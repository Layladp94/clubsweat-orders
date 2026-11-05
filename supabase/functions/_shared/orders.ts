// Menu loading, cart operations, pass (membership) logic and checkout.

import { db, type Customer, type MenuCategory, type MenuItem, type Modifier, type ModifierGroup, type Order, type OrderLine, type Pass, type PassProduct } from "./db.ts";
import { env } from "./env.ts";
import { createCheckout } from "./yoco.ts";

export type Menu = {
  categories: MenuCategory[];
  items: MenuItem[];
  groups: ModifierGroup[];
  modifiers: Modifier[];
  passProducts: PassProduct[];
};

export async function loadMenu(): Promise<Menu> {
  const s = db();
  const [c, i, g, m, p] = await Promise.all([
    s.from("menu_categories").select("*").order("sort"),
    s.from("menu_items").select("*").eq("active", true).order("sort"),
    s.from("modifier_groups").select("*").order("sort"),
    s.from("modifiers").select("*").order("sort"),
    s.from("pass_products").select("*").eq("active", true).order("sort"),
  ]);
  for (const r of [c, i, g, m, p]) if (r.error) throw r.error;
  return {
    categories: c.data as MenuCategory[],
    items: i.data as MenuItem[],
    groups: g.data as ModifierGroup[],
    modifiers: m.data as Modifier[],
    passProducts: p.data as PassProduct[],
  };
}

export type ChosenModifier = { group: string; name: string; price_delta_cents: number };

export function groupsFor(menu: Menu, item: MenuItem): ModifierGroup[] {
  return menu.groups.filter((g) => g.category_id === item.category_id);
}

export function defaultModifiers(menu: Menu, item: MenuItem): ChosenModifier[] {
  return groupsFor(menu, item).flatMap((g) => {
    const d = menu.modifiers.find((m) => m.group_id === g.id && m.is_default) ??
      menu.modifiers.find((m) => m.group_id === g.id);
    return d ? [{ group: g.name, name: d.name, price_delta_cents: d.price_delta_cents }] : [];
  });
}

export function isCreditEligible(menu: Menu, item: MenuItem): boolean {
  return menu.categories.find((c) => c.id === item.category_id)?.credit_eligible ?? false;
}

// ---------------------------------------------------------------------------
// Draft orders (the cart)
// ---------------------------------------------------------------------------
export async function getOrCreateDraft(customer: Customer): Promise<Order> {
  const s = db();
  const draftId = customer.state?.draft_order_id as string | undefined;
  if (draftId) {
    const { data } = await s.from("orders").select("*").eq("id", draftId).eq("status", "draft").maybeSingle();
    if (data) return data as Order;
  }
  const { data, error } = await s.from("orders").insert({ customer_id: customer.id, status: "draft" }).select("*").single();
  if (error) throw error;
  await setState(customer, { ...customer.state, draft_order_id: data.id });
  return data as Order;
}

export async function addLine(menu: Menu, order: Order, item: MenuItem, mods: ChosenModifier[], qty = 1): Promise<void> {
  const unit = item.price_cents + mods.reduce((a, m) => a + m.price_delta_cents, 0);
  const rows = Array.from({ length: qty }, () => ({
    order_id: order.id,
    item_id: item.id,
    item_name: item.name,
    qty: 1,                       // one row per unit keeps pass credits simple
    unit_price_cents: unit,
    modifiers: mods,
    line_total_cents: unit,
    credit_eligible: isCreditEligible(menu, item),
  }));
  const { error } = await db().from("order_lines").insert(rows);
  if (error) throw error;
  await recalcTotal(order.id);
}

export async function recalcTotal(orderId: string): Promise<number> {
  const s = db();
  const { data } = await s.from("order_lines").select("line_total_cents").eq("order_id", orderId);
  const total = (data ?? []).reduce((a, l) => a + l.line_total_cents, 0);
  await s.from("orders").update({ total_cents: total }).eq("id", orderId);
  return total;
}

export async function getLines(orderId: string): Promise<OrderLine[]> {
  const { data, error } = await db().from("order_lines").select("*").eq("order_id", orderId).order("id");
  if (error) throw error;
  return data as OrderLine[];
}

export async function cancelDraft(customer: Customer): Promise<void> {
  const draftId = customer.state?.draft_order_id as string | undefined;
  if (draftId) {
    await db().from("orders").update({ status: "cancelled" }).eq("id", draftId).in("status", ["draft", "awaiting_payment"]);
  }
  await setState(customer, { step: "home" });
}

/** Copy the customer's last completed order into a fresh draft. */
export async function repeatLastOrder(customer: Customer, menu: Menu): Promise<Order | null> {
  if (!customer.last_order_id) return null;
  const old = await getLines(customer.last_order_id);
  if (!old.length) return null;
  // Cancel any existing draft first so "usual" starts clean
  await cancelDraft(customer);
  const order = await getOrCreateDraft({ ...customer, state: {} });
  const rows = old
    .map((l) => {
      const item = menu.items.find((i) => i.id === l.item_id);
      if (!item) return null; // item no longer on the menu
      const mods = l.modifiers ?? [];
      const unit = item.price_cents + mods.reduce((a, m) => a + m.price_delta_cents, 0);
      return {
        order_id: order.id, item_id: item.id, item_name: item.name, qty: 1,
        unit_price_cents: unit, modifiers: mods, line_total_cents: unit,
        credit_eligible: isCreditEligible(menu, item),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (!rows.length) return null;
  const { error } = await db().from("order_lines").insert(rows);
  if (error) throw error;
  await recalcTotal(order.id);
  return order;
}

export async function setState(customer: Customer, state: Record<string, unknown>): Promise<void> {
  customer.state = state;
  await db().from("customers").update({ state }).eq("id", customer.id);
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------
export async function activePass(customerId: string): Promise<Pass | null> {
  const { data } = await db()
    .from("passes")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const p = data as Pass | null;
  if (p && p.kind === "credits" && (p.credits_remaining ?? 0) <= 0) return null;
  return p;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

/** How many credit-eligible lines in this order the pass can cover right now. */
export function passCoverage(pass: Pass | null, lines: OrderLine[]): number {
  if (!pass) return 0;
  const eligible = lines.filter((l) => l.credit_eligible).length;
  if (pass.kind === "credits") return Math.min(eligible, pass.credits_remaining ?? 0);
  if (pass.kind === "daily") return pass.last_daily_use === todayStr() ? 0 : Math.min(eligible, 1);
  return 0;
}

export function describePass(pass: Pass | null, product?: PassProduct | null): string {
  if (!pass) return "You don't have an active coffee pass.";
  const exp = new Date(pass.expires_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  if (pass.kind === "credits") {
    return `${product?.name ?? "Coffee pass"}: ${pass.credits_remaining} coffee${pass.credits_remaining === 1 ? "" : "s"} left, valid until ${exp}.`;
  }
  const used = pass.last_daily_use === todayStr() ? "Today's coffee is used." : "Today's coffee is still available.";
  return `${product?.name ?? "Daily pass"} valid until ${exp}. ${used}`;
}

/** Deduct credits for the lines marked paid_by_credit on a paid order. */
export async function applyPassDeduction(order: Order): Promise<{ remaining: number | null; low: boolean }> {
  if (!order.pass_id) return { remaining: null, low: false };
  const s = db();
  const { data: pass } = await s.from("passes").select("*").eq("id", order.pass_id).single();
  if (!pass) return { remaining: null, low: false };
  const lines = await getLines(order.id);
  const n = lines.filter((l) => l.paid_by_credit).length;
  if (n === 0) return { remaining: pass.credits_remaining, low: false };
  if (pass.kind === "credits") {
    const remaining = Math.max(0, (pass.credits_remaining ?? 0) - n);
    await s.from("passes").update({ credits_remaining: remaining }).eq("id", pass.id);
    return { remaining, low: remaining > 0 && remaining <= 2 };
  }
  await s.from("passes").update({ last_daily_use: todayStr() }).eq("id", pass.id);
  return { remaining: null, low: false };
}

/** Create (or renew) a pass after a successful pass payment. */
export async function grantPass(customerId: string, product: PassProduct, paymentId: string): Promise<Pass> {
  const s = db();
  const now = new Date();
  const { data: current } = await s
    .from("passes").select("*").eq("customer_id", customerId).eq("status", "active")
    .order("expires_at", { ascending: false }).limit(1).maybeSingle();

  let startsAt = now;
  let carryCredits = 0;
  if (current) {
    const curExp = new Date(current.expires_at);
    if (curExp > now) startsAt = curExp;                  // renewal starts when the old one ends
    if (current.kind === "credits" && product.kind === "credits") {
      carryCredits = current.credits_remaining ?? 0;      // unused credits roll over
    }
    await s.from("passes").update({ status: "expired" }).eq("id", current.id);
  }
  const expiresAt = new Date(startsAt.getTime() + product.valid_days * 86400_000);
  const { data, error } = await s.from("passes").insert({
    customer_id: customerId,
    product_id: product.id,
    kind: product.kind,
    credits_remaining: product.kind === "credits" ? (product.credits ?? 0) + carryCredits : null,
    starts_at: now.toISOString(),     // usable immediately
    expires_at: expiresAt.toISOString(),
    status: "active",
    renewal_payment_id: paymentId,
  }).select("*").single();
  if (error) throw error;
  return data as Pass;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export function payUrl(paymentId: string): string {
  return `${env("PUBLIC_FUNCTIONS_URL")}/pay/${paymentId}`;
}

export async function createPayment(opts: {
  customer: Customer;
  purpose: "order" | "pass";
  amountCents: number;
  orderId?: string;
  passProductId?: string;
}): Promise<{ id: string; url: string }> {
  const s = db();
  const { data: row, error } = await s.from("payments").insert({
    purpose: opts.purpose,
    order_id: opts.orderId ?? null,
    pass_product_id: opts.passProductId ?? null,
    customer_id: opts.customer.id,
    amount_cents: opts.amountCents,
  }).select("*").single();
  if (error) throw error;

  const base = env("PUBLIC_FUNCTIONS_URL");
  const checkout = await createCheckout({
    amountCents: opts.amountCents,
    metadata: { paymentId: row.id, purpose: opts.purpose, customer: opts.customer.wa_id },
    successUrl: `${base}/pay/done?status=success`,
    cancelUrl: `${base}/pay/done?status=cancelled`,
    failureUrl: `${base}/pay/done?status=failed`,
  });
  await s.from("payments").update({ checkout_id: checkout.id, redirect_url: checkout.redirectUrl }).eq("id", row.id);
  return { id: row.id, url: payUrl(row.id) };
}

/**
 * Checkout a draft order. Returns what the bot should tell the customer.
 */
export async function checkoutOrder(customer: Customer, order: Order): Promise<
  | { kind: "paid_by_pass"; order: Order; remainingCredits: number | null; low: boolean }
  | { kind: "pay"; order: Order; amountCents: number; url: string; coveredByPass: number }
  | { kind: "empty" }
> {
  const s = db();
  const lines = await getLines(order.id);
  if (!lines.length) return { kind: "empty" };

  const pass = await activePass(customer.id);
  const cover = passCoverage(pass, lines);

  // Mark which lines the pass will cover (credit-eligible first, cheapest last)
  let left = cover;
  const coveredIds: string[] = [];
  for (const l of lines) {
    if (left > 0 && l.credit_eligible) { coveredIds.push(l.id); left--; }
  }
  if (coveredIds.length) {
    await s.from("order_lines").update({ paid_by_credit: true }).in("id", coveredIds);
  }
  const due = lines.filter((l) => !coveredIds.includes(l.id)).reduce((a, l) => a + l.line_total_cents, 0);

  if (due === 0) {
    const { data: paid, error } = await s.from("orders").update({
      status: "paid", paid_with: "pass", pass_id: pass!.id, paid_at: new Date().toISOString(),
    }).eq("id", order.id).select("*").single();
    if (error) throw error;
    const ded = await applyPassDeduction(paid as Order);
    await s.from("customers").update({ last_order_id: order.id, state: { step: "home" } }).eq("id", customer.id);
    return { kind: "paid_by_pass", order: paid as Order, remainingCredits: ded.remaining, low: ded.low };
  }

  const pay = await createPayment({ customer, purpose: "order", amountCents: due, orderId: order.id });
  const { data: updated, error } = await s.from("orders").update({
    status: "awaiting_payment", pass_id: pass && cover > 0 ? pass.id : null,
  }).eq("id", order.id).select("*").single();
  if (error) throw error;
  await setState(customer, { step: "awaiting_payment", draft_order_id: order.id, payment_id: pay.id });
  return { kind: "pay", order: updated as Order, amountCents: due, url: pay.url, coveredByPass: cover };
}

export function formatLines(lines: OrderLine[]): string {
  // Collapse identical lines into "2 x Flat white (Large, Oat)"
  const groups = new Map<string, { n: number; l: OrderLine }>();
  for (const l of lines) {
    const key = `${l.item_name}|${(l.modifiers ?? []).map((m) => m.name).join(",")}`;
    const g = groups.get(key);
    if (g) g.n++; else groups.set(key, { n: 1, l });
  }
  return [...groups.values()].map(({ n, l }) => {
    const mods = (l.modifiers ?? []).filter((m) => m.name).map((m) => m.name).join(", ");
    return `${n} x ${l.item_name}${mods ? ` (${mods})` : ""}${l.paid_by_credit ? " – pass" : ""}`;
  }).join("\n");
}
