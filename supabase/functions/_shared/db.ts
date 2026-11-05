import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { env } from "./env.ts";

let client: SupabaseClient | null = null;

/** Service-role client: bypasses RLS. Only ever used server-side. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
  }
  return client;
}

export type Customer = {
  id: string;
  wa_id: string;
  name: string | null;
  opted_in: boolean;
  state: Record<string, unknown>;
  last_order_id: string | null;
};

export type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  sort: number;
};

export type MenuCategory = {
  id: string;
  name: string;
  sort: number;
  credit_eligible: boolean;
};

export type ModifierGroup = {
  id: string;
  category_id: string;
  name: string;
  prompt: string;
  required: boolean;
  sort: number;
};

export type Modifier = {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  is_default: boolean;
  sort: number;
};

export type PassProduct = {
  id: string;
  name: string;
  kind: "credits" | "daily";
  credits: number | null;
  valid_days: number;
  price_cents: number;
  active: boolean;
};

export type Pass = {
  id: string;
  customer_id: string;
  product_id: string;
  kind: "credits" | "daily";
  credits_remaining: number | null;
  starts_at: string;
  expires_at: string;
  last_daily_use: string | null;
  status: "active" | "expired" | "lapsed";
};

export type Order = {
  id: string;
  short_code: string;
  customer_id: string;
  status: string;
  total_cents: number;
  paid_with: "yoco" | "pass" | null;
  pass_id: string | null;
  note: string | null;
};

export type OrderLine = {
  id: string;
  order_id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  unit_price_cents: number;
  modifiers: { group: string; name: string; price_delta_cents: number }[];
  line_total_cents: number;
  credit_eligible: boolean;
  paid_by_credit: boolean;
};

/** Record an inbound/outbound message for the inbox and audit trail. */
export async function logMessage(m: {
  customer_id: string;
  direction: "in" | "out";
  wa_message_id?: string | null;
  kind?: string;
  body?: string | null;
  payload?: unknown;
  sent_by?: "bot" | "staff" | null;
}): Promise<void> {
  const { error } = await db().from("messages").insert({
    customer_id: m.customer_id,
    direction: m.direction,
    wa_message_id: m.wa_message_id ?? null,
    kind: m.kind ?? "text",
    body: m.body ?? null,
    payload: m.payload ?? null,
    sent_by: m.sent_by ?? null,
  });
  if (error) console.error("logMessage failed", error);
}

/** Returns true the first time an event id is seen; false on replays. */
export async function firstTimeEvent(provider: string, eventId: string): Promise<boolean> {
  const { error } = await db().from("webhook_events").insert({ provider, event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false; // unique violation = already processed
  console.error("webhook_events insert failed", error);
  return true; // fail open rather than drop a real event
}
