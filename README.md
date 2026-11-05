# ClubSweat Coffee Bar: WhatsApp ordering

WhatsApp ordering bot + Yoco payments + prepaid coffee passes + a barista screen, for the ClubSweat gym coffee and smoothie bar in Stellenbosch.

Customers message the bar's WhatsApp number, pick from a menu (or just type their order), pay via a Yoco link or their coffee pass, and get a message when it's ready. Orders appear live on a tablet behind the bar.

## What's in here

| Path | What |
|---|---|
| `supabase/migrations/0001_schema.sql` | Database: customers, menu, orders, passes, payments, messages, settings |
| `supabase/migrations/0002_cron.sql` | Nightly renewal-reminder job (run after deploy, fill in placeholders) |
| `supabase/seed.sql` | Placeholder menu and pass products. Edit before first run. |
| `supabase/functions/whatsapp-webhook` | Receives WhatsApp messages, runs the ordering conversation |
| `supabase/functions/yoco-webhook` | Receives Yoco payment events, confirms orders, activates passes |
| `supabase/functions/pay` | Short pay links (`/pay/<id>`) that redirect to Yoco, plus the "paid" landing page |
| `supabase/functions/renewals` | Expires passes and sends renewal reminders (called nightly by pg_cron) |
| `supabase/functions/bar` | Actions from the barista screen (status changes, replies, open/closed) |
| `supabase/functions/_shared` | Bot logic, WhatsApp and Yoco clients, order/pass rules, tests |
| `barista/` | The tablet app (Vite + React), deploys to Vercel as a static site |
| `poster/` | Printable QR poster generator for offices |
| `docs/INSTALL.md` | Step-by-step install (technical, one-time) |
| `docs/HANDOVER.md` | How the owner and baristas use it day to day |
| `docs/TEMPLATES.md` | The WhatsApp message templates to submit to Meta, word for word |
| `docs/LAUNCH-DAY.md` | Moving the number from the WhatsApp Business app to the API |

## How it works

```
Customer WhatsApp ──▶ Meta Cloud API ──▶ whatsapp-webhook ──▶ Postgres (Supabase)
        ▲                                     │                       ▲
        │  menu / cart / pay link             ▼                       │ realtime
        └──────────────────────────── WhatsApp send API      barista tablet (Vercel)
                                                                      │
Customer taps Pay ──▶ /pay/<id> ──▶ Yoco hosted checkout ──▶ yoco-webhook ──┘
                                                               (order paid, bar alerted, customer told)
```

Rules the code encodes:

- A conversation is a small state machine stored on the customer row (`state`). Greeting shows home buttons: "My usual", "See menu", "My pass".
- Menu items come from the database. Lists are capped at 10 rows by WhatsApp, so with more than 10 items the bot shows categories first.
- Orders are one row per unit (qty is always 1 per line) so pass credits are simple to apply.
- A coffee pass covers credit-eligible categories (Coffee by default). It covers the whole line including milk/size extras. Remaining amount, if any, goes to Yoco.
- Credits are only deducted once an order is actually paid (or fully pass-covered).
- Passes: `credits` kind (N coffees, valid X days) or `daily` kind (one coffee per calendar day). Renewal reminders go out 2 days before expiry with a fresh pay link; unused credits roll over on renewal.
- Every inbound and outbound message is logged in `messages`, which feeds the inbox on the barista screen.
- Free-form replies to a customer only work within 24 hours of their last message (WhatsApp rule). Outside that, approved templates are used automatically where one exists.
- Webhooks are idempotent (`webhook_events`) and signature-verified (Meta app secret, Yoco Standard Webhooks).

## Developing

```bash
npm install                 # installs deno + supabase CLI locally
npm run check:functions     # type-check the edge functions
npm run test:functions      # unit tests for the pure logic
npm run barista:dev         # tablet app on http://localhost:5180 (add ?demo to see sample orders without a backend)
```

Everything else is in `docs/INSTALL.md`.
