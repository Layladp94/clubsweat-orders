// Receives WhatsApp Cloud API webhooks.
//   GET  -> Meta's one-time verification handshake
//   POST -> inbound messages and delivery statuses

import { firstTimeEvent } from "../_shared/db.ts";
import { env, optionalEnv } from "../_shared/env.ts";
import { handleInbound } from "../_shared/bot.ts";
import { parseInbound, verifyMetaSignature } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === env("WA_VERIFY_TOKEN") && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  const appSecret = optionalEnv("WA_APP_SECRET");
  if (appSecret) {
    const ok = await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret);
    if (!ok) return new Response("bad signature", { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const inbound = parseInbound(body);

  // Meta retries on non-200 and resends on timeouts: process in the background
  // and answer immediately, with message-id de-duplication.
  const work = (async () => {
    for (const m of inbound) {
      if (!(await firstTimeEvent("whatsapp", m.messageId))) continue;
      try {
        await handleInbound(m);
      } catch (e) {
        console.error("handleInbound failed", m.messageId, e);
      }
    }
  })();

  // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;

  return new Response("ok", { status: 200 });
});
