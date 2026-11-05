// The ordering conversation. One inbound message in, one or two messages out.

import { db, type Customer, type MenuItem, type Order } from "./db.ts";
import { rands } from "./env.ts";
import { parseOrderText } from "./ai.ts";
import { notifyNewOrder } from "./notify.ts";
import {
  activePass, addLine, cancelDraft, checkoutOrder, createPayment, defaultModifiers, describePass,
  formatLines, getLines, getOrCreateDraft, groupsFor, loadMenu, type Menu, passCoverage, repeatLastOrder, setState,
} from "./orders.ts";
import { type Inbound, type ListSection, type Sender, senderFor } from "./whatsapp.ts";

const GREETINGS = /^(hi|hello|hey|hallo|howzit|morning|good morning|yo|start|menu|order|hi there|coffee)[!. ]*$/i;

export async function handleInbound(inb: Inbound): Promise<void> {
  const s = db();

  // 1. Upsert customer
  let { data: customer } = await s.from("customers").select("*").eq("wa_id", inb.waId).maybeSingle();
  if (!customer) {
    const ins = await s.from("customers").insert({ wa_id: inb.waId, name: inb.name }).select("*").single();
    if (ins.error) throw ins.error;
    customer = ins.data;
  } else {
    const patch: Record<string, unknown> = { last_inbound_at: new Date().toISOString() };
    if (!customer.name && inb.name) patch.name = inb.name;
    await s.from("customers").update(patch).eq("id", customer.id);
  }
  const c = customer as Customer;

  // 2. Log inbound
  await s.from("messages").insert({
    customer_id: c.id, direction: "in", wa_message_id: inb.messageId, kind: inb.type,
    body: inb.text ?? `[${inb.type}]`, payload: inb.raw,
  });

  const send = senderFor(c.wa_id, c.id);
  const text = (inb.text ?? "").trim();

  // 3. Opt-out / opt-in
  if (/^stop$/i.test(text)) {
    await s.from("customers").update({ opted_in: false }).eq("id", c.id);
    await send.text("You won't get reminders from us any more. Reply START to switch them back on. You can still order here any time.");
    return;
  }
  if (/^start$/i.test(text) && !c.opted_in) {
    await s.from("customers").update({ opted_in: true }).eq("id", c.id);
    c.opted_in = true;
  }

  // 4. Bar closed?
  const { data: settings } = await s.from("bar_settings").select("*").eq("id", 1).single();
  if (settings && !settings.is_open && !inb.replyId) {
    await send.text(settings.closed_message);
    return;
  }

  // 5. Non-text media
  if (!text && !inb.replyId) {
    await send.text("I can only read text here. Type what you'd like, or reply *menu*.");
    return;
  }

  const menu = await loadMenu();
  try {
    if (inb.replyId) await handleReply(c, menu, send, inb.replyId);
    else await handleText(c, menu, send, text);
  } catch (e) {
    console.error("bot error", e);
    await send.text("Something went wrong on our side. Please try again, or order at the counter.");
  }
}

// ---------------------------------------------------------------------------
async function handleText(c: Customer, menu: Menu, send: Sender, text: string): Promise<void> {
  const lower = text.toLowerCase();
  if (GREETINGS.test(lower) || !c.state?.step) return sendHome(c, menu, send);
  if (/^(pass|balance|my pass|membership)$/i.test(lower)) return showPass(c, menu, send);
  if (/^(cancel|clear|reset)$/i.test(lower)) {
    await cancelDraft(c);
    await send.text("No problem, cleared.");
    return sendHome(c, menu, send);
  }
  if (/^(help|\?)$/i.test(lower)) return sendHelp(send);
  if (c.state?.step === "awaiting_payment") {
    const payUrl = c.state.pay_url as string | undefined;
    if (payUrl) {
      await send.ctaUrl("Your last order is waiting for payment. Tap to pay, or reply *cancel* to start over.", "Pay now", payUrl);
      return;
    }
  }

  // Free text order
  const parsed = await parseOrderText(text, menu);
  if (parsed.unclear || !parsed.lines.length) {
    await send.text("I didn't quite catch that. Pick from the menu below, or type something like *2 flat whites, one oat*.");
    return showMenu(c, menu, send);
  }
  const order = await getOrCreateDraft(c);
  for (const l of parsed.lines) {
    const item = menu.items.find((i) => i.id === l.item_id)!;
    await addLine(menu, order, item, l.modifiers, l.qty);
  }
  if (parsed.note) await db().from("orders").update({ note: parsed.note }).eq("id", order.id);
  return showCart(c, menu, send, order);
}

// ---------------------------------------------------------------------------
async function handleReply(c: Customer, menu: Menu, send: Sender, id: string): Promise<void> {
  const [kind, arg] = id.split(":");
  switch (kind) {
    case "home": return sendHome(c, menu, send);
    case "menu": return showMenu(c, menu, send);
    case "help": return sendHelp(send);
    case "cat": return showCategory(c, menu, send, arg);
    case "item": return startItem(c, menu, send, arg);
    case "mod": return chooseModifier(c, menu, send, arg);
    case "usual": {
      const order = await repeatLastOrder(c, menu);
      if (!order) {
        await send.text("I couldn't find a previous order to repeat.");
        return showMenu(c, menu, send);
      }
      return showCart(c, menu, send, order);
    }
    case "addmore": return showMenu(c, menu, send);
    case "checkout": return doCheckout(c, menu, send);
    case "cancel": {
      await cancelDraft(c);
      await send.text("Cancelled. Nothing was charged.");
      return sendHome(c, menu, send);
    }
    case "pass": return showPass(c, menu, send);
    case "buypass": return buyPass(c, menu, send, arg);
    default:
      return sendHome(c, menu, send);
  }
}

// ---------------------------------------------------------------------------
async function sendHome(c: Customer, menu: Menu, send: Sender): Promise<void> {
  await setState(c, { step: "home" });
  const first = (c.name ?? "").split(" ")[0];
  const pass = await activePass(c.id);
  let body = `Hi${first ? " " + first : ""}! Welcome to the ClubSweat coffee bar.`;
  if (pass) {
    const product = menu.passProducts.find((p) => p.id === pass.product_id) ?? null;
    body += `\n\n${describePass(pass, product)}`;
  }
  body += "\n\nWhat can we make you?";

  let usualLabel: string | null = null;
  if (c.last_order_id) {
    const lines = await getLines(c.last_order_id);
    if (lines.length) {
      const first = lines[0];
      usualLabel = lines.length === 1 ? `Usual: ${first.item_name}` : `My usual (${lines.length})`;
    }
  }
  const buttons = usualLabel
    ? [{ id: "usual", title: usualLabel }, { id: "menu", title: "See menu" }, { id: "pass", title: "My pass" }]
    : [{ id: "menu", title: "See menu" }, { id: "pass", title: "Coffee passes" }, { id: "help", title: "Help" }];
  await send.buttons(body, buttons);
}

async function sendHelp(send: Sender): Promise<void> {
  await send.text(
    "How this works:\n" +
    "1. Reply *menu* and pick your drinks.\n" +
    "2. Tap *Checkout* and pay with the secure Yoco link (or your coffee pass covers it).\n" +
    "3. We message you when it's ready at the counter.\n\n" +
    "You can also just type your order, e.g. *2 flat whites, one oat milk*.\n" +
    "Reply *pass* to see or buy a coffee pass. Reply *cancel* to start over.",
  );
}

async function showMenu(c: Customer, menu: Menu, send: Sender): Promise<void> {
  await setState(c, { ...c.state, step: "choose_item" });
  const cats = menu.categories.filter((cat) => menu.items.some((i) => i.category_id === cat.id));
  if (menu.items.length <= 10) {
    const sections: ListSection[] = cats.map((cat) => ({
      title: cat.name,
      rows: menu.items.filter((i) => i.category_id === cat.id).map(itemRow),
    }));
    await send.list("Here's the menu. Pick one item at a time, you can add more after.", "Menu", sections);
    return;
  }
  await send.list("What would you like?", "Choose", [{
    title: "Categories",
    rows: cats.map((cat) => ({ id: `cat:${cat.id}`, title: cat.name, description: `${menu.items.filter((i) => i.category_id === cat.id).length} items` })),
  }]);
}

const itemRow = (i: MenuItem) => ({ id: `item:${i.id}`, title: i.name, description: `${rands(i.price_cents)}${i.description ? " · " + i.description : ""}` });

async function showCategory(c: Customer, menu: Menu, send: Sender, catId: string): Promise<void> {
  const cat = menu.categories.find((x) => x.id === catId);
  const items = menu.items.filter((i) => i.category_id === catId).slice(0, 10);
  if (!cat || !items.length) return showMenu(c, menu, send);
  await setState(c, { ...c.state, step: "choose_item" });
  await send.list(`${cat.name}:`, "Choose", [{ title: cat.name, rows: items.map(itemRow) }]);
}

async function startItem(c: Customer, menu: Menu, send: Sender, itemId: string): Promise<void> {
  const item = menu.items.find((i) => i.id === itemId);
  if (!item) return showMenu(c, menu, send);
  const groups = groupsFor(menu, item);
  const order = await getOrCreateDraft(c);
  if (!groups.length) {
    await addLine(menu, order, item, []);
    return showCart(c, menu, send, order);
  }
  await setState(c, { ...c.state, step: "choose_modifier", pending: { item_id: item.id, group_idx: 0, modifiers: [] } });
  return askModifier(c, menu, send, item, 0);
}

async function askModifier(c: Customer, menu: Menu, send: Sender, item: MenuItem, groupIdx: number): Promise<void> {
  const group = groupsFor(menu, item)[groupIdx];
  const opts = menu.modifiers.filter((m) => m.group_id === group.id);
  const label = (m: typeof opts[number]) => m.price_delta_cents ? `${m.name} +${rands(m.price_delta_cents)}` : m.name;
  if (opts.length <= 3) {
    await send.buttons(`${item.name}: ${group.prompt}`, opts.map((m) => ({ id: `mod:${m.id}`, title: label(m) })));
  } else {
    await send.list(`${item.name}: ${group.prompt}`, group.name, [{ title: group.name, rows: opts.map((m) => ({ id: `mod:${m.id}`, title: label(m) })) }]);
  }
}

async function chooseModifier(c: Customer, menu: Menu, send: Sender, modId: string): Promise<void> {
  const pending = c.state?.pending as { item_id: string; group_idx: number; modifiers: { group: string; name: string; price_delta_cents: number }[] } | undefined;
  const mod = menu.modifiers.find((m) => m.id === modId);
  if (!pending || !mod) return showMenu(c, menu, send);
  const item = menu.items.find((i) => i.id === pending.item_id);
  if (!item) return showMenu(c, menu, send);
  const groups = groupsFor(menu, item);
  const group = groups.find((g) => g.id === mod.group_id);
  const mods = [...pending.modifiers.filter((m) => m.group !== group?.name), { group: group?.name ?? "", name: mod.name, price_delta_cents: mod.price_delta_cents }];
  const nextIdx = pending.group_idx + 1;
  if (nextIdx < groups.length) {
    await setState(c, { ...c.state, pending: { ...pending, group_idx: nextIdx, modifiers: mods } });
    return askModifier(c, menu, send, item, nextIdx);
  }
  const order = await getOrCreateDraft(c);
  await addLine(menu, order, item, mods);
  await setState(c, { ...c.state, step: "cart", pending: null });
  return showCart(c, menu, send, order);
}

async function showCart(c: Customer, menu: Menu, send: Sender, order: Order): Promise<void> {
  const lines = await getLines(order.id);
  const total = lines.reduce((a, l) => a + l.line_total_cents, 0);
  await setState(c, { ...c.state, step: "cart", draft_order_id: order.id, pending: null });
  const pass = await activePass(c.id);
  const cover = passCoverage(pass, lines);
  let body = `Your order:\n${formatLines(lines)}\n\nTotal: *${rands(total)}*`;
  if (cover > 0) {
    const due = lines.filter((l) => !l.credit_eligible).reduce((a, l) => a + l.line_total_cents, 0) +
      lines.filter((l) => l.credit_eligible).slice(cover).reduce((a, l) => a + l.line_total_cents, 0);
    body += `\nYour pass covers ${cover} coffee${cover === 1 ? "" : "s"}. To pay: *${rands(due)}*`;
  }
  await send.buttons(body, [
    { id: "checkout", title: "Checkout" },
    { id: "addmore", title: "Add more" },
    { id: "cancel", title: "Cancel" },
  ]);
}

async function doCheckout(c: Customer, menu: Menu, send: Sender): Promise<void> {
  const draftId = c.state?.draft_order_id as string | undefined;
  if (!draftId) return showMenu(c, menu, send);
  const { data: order } = await db().from("orders").select("*").eq("id", draftId).in("status", ["draft", "awaiting_payment"]).maybeSingle();
  if (!order) return showMenu(c, menu, send);

  const result = await checkoutOrder(c, order as Order);
  if (result.kind === "empty") {
    await send.text("Your order is empty.");
    return showMenu(c, menu, send);
  }
  if (result.kind === "paid_by_pass") {
    await notifyNewOrder(c, result.order, { remainingCredits: result.remainingCredits, low: result.low });
    return;
  }
  await setState(c, { ...c.state, step: "awaiting_payment", pay_url: result.url });
  const note = result.coveredByPass > 0 ? `Your pass covers ${result.coveredByPass} coffee${result.coveredByPass === 1 ? "" : "s"}. ` : "";
  await send.ctaUrl(
    `${note}Tap below to pay *${rands(result.amountCents)}* securely with Yoco (card, Apple Pay or Google Pay). We start making it the moment payment lands.`,
    `Pay ${rands(result.amountCents)}`,
    result.url,
    `Order ${result.order.short_code}`,
  );
}

async function showPass(c: Customer, menu: Menu, send: Sender): Promise<void> {
  const pass = await activePass(c.id);
  const product = pass ? menu.passProducts.find((p) => p.id === pass.product_id) ?? null : null;
  const intro = pass
    ? describePass(pass, product) + "\n\nWant to top up or renew?"
    : "Coffee passes save you money and skip payment on every order: just order and collect.";
  const rows = menu.passProducts.map((p) => ({
    id: `buypass:${p.id}`,
    title: p.name,
    description: `${rands(p.price_cents)} · ${p.kind === "credits" ? `${p.credits} coffees` : "1 coffee a day"} · ${p.valid_days} days`,
  }));
  if (!rows.length) {
    await send.text(intro);
    return;
  }
  await send.list(intro, "See passes", [{ title: "Coffee passes", rows }]);
}

async function buyPass(c: Customer, menu: Menu, send: Sender, productId: string): Promise<void> {
  const product = menu.passProducts.find((p) => p.id === productId);
  if (!product) return showPass(c, menu, send);
  const pay = await createPayment({ customer: c, purpose: "pass", amountCents: product.price_cents, passProductId: product.id });
  await setState(c, { ...c.state, step: "home", pay_url: pay.url });
  await send.ctaUrl(
    `*${product.name}* for ${rands(product.price_cents)}. Tap to pay. Your pass activates the moment payment lands and any unused coffees on a current pass roll over.`,
    `Pay ${rands(product.price_cents)}`,
    pay.url,
  );
}
