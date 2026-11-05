import { createClient } from "@supabase/supabase-js";

export const DEMO = new URLSearchParams(location.search).has("demo");
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://demo.invalid";
export const FUNCTIONS_URL = (import.meta.env.VITE_FUNCTIONS_URL as string | undefined) ?? `${SUPABASE_URL}/functions/v1`;

export const supabase = createClient(SUPABASE_URL, (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "demo");

/** Call the `bar` edge function with the signed-in user's token. */
export async function barAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "Not signed in" };
  const res = await fetch(`${FUNCTIONS_URL}/bar`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json.error ?? res.statusText };
  return { ok: true, ...json };
}

export const rands = (cents: number) => `R${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

export type BoardOrder = {
  id: string;
  short_code: string;
  status: "paid" | "making" | "ready" | "collected" | "cancelled" | "awaiting_payment" | "draft";
  total_cents: number;
  paid_with: "yoco" | "pass" | null;
  note: string | null;
  created_at: string;
  paid_at: string | null;
  ready_at: string | null;
  customer_name: string | null;
  wa_id: string;
  lines: { item_name: string; qty: number; modifiers: { group: string; name: string }[] }[];
};
