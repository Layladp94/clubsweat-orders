// Thin wrapper over the WhatsApp Cloud API (Meta Graph API).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages

import { env } from "./env.ts";
import { logMessage } from "./db.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

export type Button = { id: string; title: string }; // title max 20 chars, max 3 buttons
export type ListRow = { id: string; title: string; description?: string }; // title 24, desc 72
export type ListSection = { title: string; rows: ListRow[] }; // max 10 rows in total

type SendResult = { ok: true; id: string } | { ok: false; error: string; code?: number };

async function post(payload: Record<string, unknown>): Promise<SendResult> {
  const res = await fetch(`${GRAPH}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env("WA_ACCESS_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code as number | undefined;
    const msg = body?.error?.message ?? res.statusText;
    console.error("WhatsApp send failed", res.status, code, msg);
    return { ok: false, error: msg, code };
  }
  return { ok: true, id: body?.messages?.[0]?.id ?? "" };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export type Sender = {
  text(body: string): Promise<SendResult>;
  buttons(body: string, buttons: Button[], footer?: string): Promise<SendResult>;
  list(body: string, buttonLabel: string, sections: ListSection[], footer?: string): Promise<SendResult>;
  ctaUrl(body: string, label: string, url: string, footer?: string): Promise<SendResult>;
  template(name: string, bodyParams: string[], urlSuffix?: string, lang?: string): Promise<SendResult>;
};

/**
 * Build a sender bound to one customer so every outbound message is logged.
 * `sentBy` is 'bot' or 'staff' (for the inbox).
 */
export function senderFor(to: string, customerId: string, sentBy: "bot" | "staff" = "bot"): Sender {
  const log = (kind: string, body: string, payload: unknown, r: SendResult) =>
    logMessage({
      customer_id: customerId,
      direction: "out",
      wa_message_id: r.ok ? r.id : null,
      kind,
      body: r.ok ? body : `[FAILED: ${r.error}] ${body}`,
      payload,
      sent_by: sentBy,
    });

  return {
    async text(body) {
      const r = await post({ to, type: "text", text: { body, preview_url: false } });
      await log("text", body, null, r);
      return r;
    },
    async buttons(body, buttons, footer) {
      const payload = {
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: "reply",
              reply: { id: b.id, title: clip(b.title, 20) },
            })),
          },
        },
      };
      const r = await post(payload);
      await log("interactive", `${body}\n[${buttons.map((b) => b.title).join(" | ")}]`, payload, r);
      return r;
    },
    async list(body, buttonLabel, sections, footer) {
      const payload = {
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: body },
          ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
          action: {
            button: clip(buttonLabel, 20),
            sections: sections.map((s) => ({
              title: clip(s.title, 24),
              rows: s.rows.map((row) => ({
                id: row.id,
                title: clip(row.title, 24),
                ...(row.description ? { description: clip(row.description, 72) } : {}),
              })),
            })),
          },
        },
      };
      const r = await post(payload);
      await log("interactive", `${body}\n[list: ${sections.flatMap((s) => s.rows.map((x) => x.title)).join(", ")}]`, payload, r);
      return r;
    },
    async ctaUrl(body, label, url, footer) {
      const payload = {
        to,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: body },
          ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
          action: { name: "cta_url", parameters: { display_text: clip(label, 20), url } },
        },
      };
      const r = await post(payload);
      await log("interactive", `${body}\n[${label}: ${url}]`, payload, r);
      return r;
    },
    async template(name, bodyParams, urlSuffix, lang = "en") {
      const components: unknown[] = [];
      if (bodyParams.length) {
        components.push({
          type: "body",
          parameters: bodyParams.map((t) => ({ type: "text", text: t })),
        });
      }
      if (urlSuffix !== undefined) {
        components.push({
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: urlSuffix }],
        });
      }
      const payload = {
        to,
        type: "template",
        template: { name, language: { code: lang }, components },
      };
      const r = await post(payload);
      await log("template", `template:${name} ${JSON.stringify(bodyParams)}`, payload, r);
      return r;
    },
  };
}

/**
 * Send free-form first; if WhatsApp rejects because the 24-hour window is
 * closed (error 131047), fall back to an approved template.
 */
export async function textOrTemplate(
  s: Sender,
  text: string,
  template: { name: string; params: string[]; urlSuffix?: string },
): Promise<SendResult> {
  const r = await s.text(text);
  if (r.ok || r.code !== 131047) return r;
  return s.template(template.name, template.params, template.urlSuffix);
}

// ---------------------------------------------------------------------------
// Inbound parsing
// ---------------------------------------------------------------------------
export type Inbound = {
  waId: string;        // sender phone, digits
  name: string | null; // profile name
  messageId: string;
  type: string;
  text: string | null;         // text body, or button/list title
  replyId: string | null;      // interactive reply id
  raw: Record<string, unknown>;
};

export function parseInbound(body: unknown): Inbound[] {
  const out: Inbound[] = [];
  // deno-lint-ignore no-explicit-any
  const entries = (body as any)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contactName: string | null = value.contacts?.[0]?.profile?.name ?? null;
      for (const m of value.messages ?? []) {
        let text: string | null = null;
        let replyId: string | null = null;
        if (m.type === "text") text = m.text?.body ?? null;
        if (m.type === "interactive") {
          const i = m.interactive;
          if (i?.type === "button_reply") {
            replyId = i.button_reply?.id ?? null;
            text = i.button_reply?.title ?? null;
          } else if (i?.type === "list_reply") {
            replyId = i.list_reply?.id ?? null;
            text = i.list_reply?.title ?? null;
          }
        }
        if (m.type === "button") { // quick-reply button on a template
          replyId = m.button?.payload ?? null;
          text = m.button?.text ?? null;
        }
        out.push({
          waId: String(m.from),
          name: contactName,
          messageId: String(m.id),
          type: String(m.type),
          text,
          replyId,
          raw: m,
        });
      }
    }
  }
  return out;
}

/** Verify X-Hub-Signature-256 from Meta using the app secret. */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, header.slice(7));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
