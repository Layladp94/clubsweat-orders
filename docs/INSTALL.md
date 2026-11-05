# Install guide (one-time, technical)

Work through this top to bottom. Expect two to three hours of clicking, plus waiting on Meta approvals. Everything up to step 7 can be done against Meta's free test number while the bar keeps using the WhatsApp Business app.

You need: the gym's Meta Business Portfolio admin login, the gym's Yoco login, a Supabase account, a Vercel account, and this repo.

---

## 1. Supabase project

1. Create a project at supabase.com (region: closest available, eu-west is fine). Note the **project ref**, **anon key** and **service role key** (Project Settings → API).
2. Link the CLI and push the schema:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

3. Edit `supabase/seed.sql` with the real menu and pass prices, then run it in the SQL editor (Dashboard → SQL → paste → Run). You can also edit the menu later in the tablet app or in Table Editor.
4. Create the bar login: Authentication → Users → Add user → email + password (for example `bar@clubsweat.co.za`). Untick "send confirmation". This is what the tablet signs in with.
5. Realtime: Database → Publications → `supabase_realtime` should list `orders` and `messages` (the migration adds them; verify).

## 2. Yoco

1. Yoco portal → Sell online → Payment gateway. Copy the **secret key**. Use the **test** key first (`sk_test_...`), swap to live at launch.
2. Register the webhook once the functions are deployed (step 4). The command is in step 5.

## 3. Meta developer app

1. developers.facebook.com → My Apps → Create app → type **Business** → connect to the ClubSweat Business Portfolio.
2. Add product **WhatsApp**. This creates a WhatsApp Business Account in the portfolio and gives you a **test number** plus a **temporary token**.
3. Note the **Phone number ID** (API Setup page) and the **App secret** (App settings → Basic).
4. Add up to 5 recipient test numbers (yours, the owner's) on the API Setup page.
5. Create a permanent token: Business Settings → Users → System users → Add (name `clubsweat-bot`, role Admin) → Assign assets: the WhatsApp account (full control) and the app → Generate token with `whatsapp_business_messaging` and `whatsapp_business_management`. Save it; it is shown once.

## 4. Deploy the edge functions

Set the secrets (values from `.env.example`):

```bash
npx supabase secrets set \
  WA_PHONE_NUMBER_ID=... WA_ACCESS_TOKEN=... WA_VERIFY_TOKEN=clubsweat-verify WA_APP_SECRET=... \
  YOCO_SECRET_KEY=sk_test_... \
  PUBLIC_FUNCTIONS_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1 \
  BAR_PHONE=27XXXXXXXXX CRON_SECRET=$(openssl rand -hex 16)
```

Deploy:

```bash
npx supabase functions deploy whatsapp-webhook yoco-webhook pay renewals bar
```

`config.toml` already turns JWT verification off for the four public endpoints and on for `bar`.

## 5. Register the Yoco webhook

Run once (replace the key and ref). It returns a `secret` starting with `whsec_`:

```bash
curl -X POST https://payments.yoco.com/api/webhooks \
  -H "Authorization: Bearer sk_test_..." -H "Content-Type: application/json" \
  -d '{"name":"clubsweat-orders","url":"https://YOUR_PROJECT_REF.supabase.co/functions/v1/yoco-webhook"}'
```

Then:

```bash
npx supabase secrets set YOCO_WEBHOOK_SECRET=whsec_...
```

When you move to the live key, register again with the live key and update the secret.

## 6. Point Meta at the webhook

Meta app → WhatsApp → Configuration → Webhook:

- Callback URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook`
- Verify token: `clubsweat-verify` (whatever you set in `WA_VERIFY_TOKEN`)
- Click Verify and save, then subscribe to the **messages** field.

Send "hi" from a test recipient number to the test number. You should get the home buttons back. Order something, tap the pay link, pay with Yoco's test card (`4242 4242 4242 4242`, any future expiry, any CVV), and watch the order land on the tablet.

## 7. Barista tablet app

```bash
cd barista
cp .env.example .env     # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_FUNCTIONS_URL
npm install && npm run build
```

Deploy to Vercel: import the repo, set **Root Directory** to `barista`, add the same three env vars, deploy. Vercel builds with `npm run build` and serves `dist/`.

On the tablet: open the Vercel URL in Safari/Chrome, sign in with the bar login, then "Add to Home Screen" so it runs full screen. Turn on Guided Access (iPad) or screen pinning (Android) so it stays put. Keep it on a charger with the screen set to never sleep.

Check the chime works: it only plays after the first tap on the page (browser rule), so tap anywhere once after loading.

## 8. Templates

Submit the templates in `docs/TEMPLATES.md` via WhatsApp Manager → Message templates. Approval usually takes minutes to a day. Nothing breaks while they're pending: the bot sends free-form text inside the 24-hour window and only needs templates for renewal reminders and for customers who went quiet.

## 9. Nightly renewals

Open `supabase/migrations/0002_cron.sql`, replace `YOUR_PROJECT_REF` and `YOUR_CRON_SECRET`, run it in the SQL editor. It schedules a 06:00 SAST call to the renewals function. Test it by hand:

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/renewals -H "x-cron-secret: YOUR_CRON_SECRET"
```

## 10. Optional: free-text order parsing with Claude

With `ANTHROPIC_API_KEY` set as a function secret, messages like "2 oat flat whites and a berry blast" are parsed by Claude into order lines. Without it, a keyword matcher does a decent job for exact item names. Add the key with `npx supabase secrets set ANTHROPIC_API_KEY=...` and redeploy `whatsapp-webhook`.

## 11. Go live

Follow `docs/LAUNCH-DAY.md` to move the real number onto the API, switch Yoco to the live key, and re-register the Yoco webhook.

---

## Where to look when something is wrong

- Supabase → Edge Functions → logs for each function. Every WhatsApp send failure is logged with Meta's error code.
- `messages` table: every message in and out, with `[FAILED: ...]` prefixed on failed sends.
- `webhook_events`: proves whether Meta/Yoco delivered an event.
- Common Meta error 131047: 24-hour window closed, needs a template. 131026: recipient not on WhatsApp or not a test recipient while on the test number. 100 with "Unsupported post request": wrong phone number ID or token.
