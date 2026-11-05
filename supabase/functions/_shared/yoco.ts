// Yoco Checkout API + Standard Webhooks signature verification.
// Docs: https://developer.yoco.com/docs/checkout-api
//       https://developer.yoco.com/guides/online-payments

import { env } from "./env.ts";

const BASE = "https://payments.yoco.com/api";

export type Checkout = { id: string; redirectUrl: string; status: string };

export async function createCheckout(opts: {
  amountCents: number;
  metadata: Record<string, string>;
  successUrl?: string;
  cancelUrl?: string;
  failureUrl?: string;
}): Promise<Checkout> {
  const res = await fetch(`${BASE}/checkouts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env("YOCO_SECRET_KEY")}`,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      amount: opts.amountCents,
      currency: "ZAR",
      metadata: opts.metadata,
      ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
      ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
      ...(opts.failureUrl ? { failureUrl: opts.failureUrl } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Yoco checkout failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return { id: body.id, redirectUrl: body.redirectUrl, status: body.status };
}

/** Register our webhook URL with Yoco. Returns the signing secret (store as YOCO_WEBHOOK_SECRET). */
export async function registerWebhook(name: string, url: string): Promise<{ id: string; secret: string }> {
  const res = await fetch(`${BASE}/webhooks`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("YOCO_SECRET_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ name, url }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Yoco webhook registration failed ${res.status}: ${JSON.stringify(body)}`);
  return { id: body.id, secret: body.secret };
}

/**
 * Standard Webhooks verification (https://www.standardwebhooks.com):
 * signed content = `${webhook-id}.${webhook-timestamp}.${body}`
 * secret = base64 after the `whsec_` prefix
 * header = "v1,<base64 signature>" (may contain several space-separated entries)
 */
export async function verifyYocoSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<{ ok: boolean; reason?: string }> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return { ok: false, reason: "missing headers" };

  // Reject stale deliveries (5 minutes)
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: "timestamp out of range" };

  const secretB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));

  const candidates = sigHeader.split(" ").map((p) => p.split(",")[1] ?? "");
  const ok = candidates.some((c) => c.length === expected.length && safeEq(c, expected));
  return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

function safeEq(a: string, b: string): boolean {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type YocoEvent = {
  id: string;
  type: "payment.succeeded" | "payment.failed" | "refund.succeeded" | "refund.failed" | string;
  createdDate: string;
  payload: {
    id: string;
    amount: number;
    currency: string;
    status?: string;
    metadata?: Record<string, string> & { checkoutId?: string };
  };
};
