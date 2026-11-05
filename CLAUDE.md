# ClubSweat coffee bar ordering: brief for Claude Code

You are continuing a build that was scaffolded for the owner of **Club Sweat** (gym + coffee and smoothie bar, 13 Andringa St, Stellenbosch, clubsweat.co.za). The owner has little time, so the goal is a system she can run from a tablet and a WhatsApp number with no technical steps day to day.

Read `README.md` first for the architecture, then `docs/INSTALL.md` for what still has to be set up. The code is complete and compiles; **nothing is deployed yet**. Your job is to carry the install through with the owner, test on Meta's test number, then launch per `docs/LAUNCH-DAY.md`.

## What the system does

Customers WhatsApp the bar number, pick drinks from interactive menus or type their order, pay through a Yoco link (or a prepaid coffee pass covers it), and get a message when it is ready. Baristas see orders on a tablet web app and tap through New → Making → Ready. Memberships are prepaid passes with automatic renewal reminders.

## Decisions already made (don't reopen without a reason)

- **Meta Cloud API directly**, no reseller. The number moves fully to the API at launch. WhatsApp "coexistence" (app + API on one number) is **not available on South African +27 numbers**, so don't propose it.
- **Yoco Checkout API** per order, with Standard Webhooks signature verification. Yoco has no card-on-file recurring billing in its public API, so memberships are **prepaid passes** (N coffees or one-a-day) and renewals are a reminder with a new pay link.
- **Supabase** (Postgres + Edge Functions in Deno) for backend, **Vercel** static hosting for the tablet app. Realtime drives the board.
- **Pass credits** are deducted only when an order is paid or fully covered. One `order_lines` row per unit. A pass covers the whole line including milk/size extras.
- Free-form WhatsApp messages only work within 24 h of the customer's last message; approved templates (`docs/TEMPLATES.md`) are used otherwise. Code falls back automatically on Meta error 131047.
- Brand: match clubsweat.co.za. Near-black `#0a0a0a`, white type at graded opacity, League Spartan lowercase headings, Space Mono uppercase letter-spaced labels, outlined pill buttons with `[ brackets ]`, red dot = live. More white space than the site. Solid white pill = the one next action.

## Layout

```
supabase/migrations/   schema (0001) and the pg_cron renewal job (0002, needs placeholders filled after deploy)
supabase/seed.sql      placeholder menu and passes: replace with the real menu before first run
supabase/functions/    whatsapp-webhook, yoco-webhook, pay, renewals, bar; shared logic in _shared/
barista/               Vite + React tablet app; `?demo` in the URL shows sample orders without a backend
docs/                  INSTALL (technical), HANDOVER (owner), TEMPLATES (Meta), LAUNCH-DAY
poster/index.html      A4 QR poster generator for offices
```

## Commands

```bash
npm install                 # installs deno + supabase CLI locally (no global installs needed)
npm run check:functions     # type-check edge functions
npm run test:functions      # unit tests (pure logic)
npm run barista:dev         # tablet app on :5180
npx supabase ...            # CLI (login, link, db push, functions deploy, secrets set)
```

## Inputs still needed from the owner

1. Real menu: items, prices, which categories get Size/Milk options, which categories a pass may pay for.
2. Pass bundles and prices (seed has 10-coffee, 20-coffee, daily as placeholders).
3. Meta Business Portfolio admin access (they already run ads from it), Yoco login, bar phone number for staff alerts.
4. Opening hours for the closed message, typical prep minutes.

## Things to verify on first live test (never exercised yet)

- Yoco: the `POST /api/checkouts` body and the `redirectUrl` field, and the webhook event shape (`payload.metadata`). Code follows developer.yoco.com docs; adjust `_shared/yoco.ts` if a field differs.
- Meta: `cta_url` interactive messages render on the customer's phone; list rows stay within the 24/72 char limits (titles are clipped in code).
- The `pay` function URL works unauthenticated (config.toml sets `verify_jwt = false`; confirm after deploy).
- Chime on the tablet needs one tap on the page first (browser autoplay rule). The handover doc says so.

## Style rules for this repo

- Keep the owner-facing docs in plain language, no jargon. Technical detail goes in INSTALL.md.
- No em-dashes in any customer-facing copy (WhatsApp messages, docs, poster). Use commas, colons or full stops.
- Don't add third-party chatbot platforms or BSPs; the point is a thin, cheap bot the owner controls.
- Prices in cents in the database, rands with VAT in anything a human sees.
