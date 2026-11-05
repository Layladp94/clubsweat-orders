// Short pay links and the post-payment landing page.
//   GET /pay/<paymentId>        -> 302 to the Yoco hosted checkout
//   GET /pay/done?status=...    -> tiny "you can go back to WhatsApp" page
// This is what the WhatsApp templates link to (fixed base URL + variable suffix).

import { db } from "../_shared/db.ts";

const page = (title: string, body: string, color: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#111;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}
  .card{max-width:360px}
  h1{font-size:28px;margin:0 0 8px;color:${color}}
  p{font-size:17px;line-height:1.5;color:#ddd;margin:0 0 20px}
  a{display:inline-block;background:${color};color:#111;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p><a href="https://wa.me/">Back to WhatsApp</a></div></body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const tail = parts[parts.length - 1] ?? "";

  if (tail === "done") {
    const status = url.searchParams.get("status");
    if (status === "success") {
      return html(page("Paid, thank you!", "Your confirmation is on its way in WhatsApp. We're making it now.", "#A3E635"));
    }
    if (status === "cancelled") {
      return html(page("Payment cancelled", "Nothing was charged. Open the pay link in WhatsApp again when you're ready.", "#FBBF24"));
    }
    return html(page("Payment didn't go through", "Nothing was charged. Tap the link in WhatsApp to try again.", "#F87171"));
  }

  if (/^[0-9a-f-]{36}$/i.test(tail)) {
    const { data } = await db().from("payments").select("redirect_url,status").eq("id", tail).maybeSingle();
    if (data?.redirect_url && data.status !== "succeeded") {
      return new Response(null, { status: 302, headers: { location: data.redirect_url } });
    }
    if (data?.status === "succeeded") {
      return html(page("Already paid", "This payment has already gone through.", "#A3E635"));
    }
  }
  return html(page("Link not found", "This payment link isn't valid any more. Reply hi in WhatsApp to start a new order.", "#F87171"), 404);
});

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
