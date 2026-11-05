# Launch day: moving the real number onto the API

Background: South African numbers can't run the WhatsApp Business app and the Cloud API at the same time (Meta's "coexistence" isn't available for +27). So the number moves fully to the API. Customers notice nothing: same number, same QR codes, same saved contact.

Do this at a quiet time (after close). Allow an hour.

## Before

- [ ] Everything in `docs/INSTALL.md` works end to end on the test number, including a real test order on the tablet.
- [ ] Templates approved (at least `order_ready` and `pass_renewal`).
- [ ] Yoco **live** secret key at hand.
- [ ] The bar phone with the SIM is charged and can receive SMS.
- [ ] The owner knows the WhatsApp Business app on that phone will stop working for this number.

## Steps

1. **Export chats** in the WhatsApp Business app (Settings → Chats → Chat history → Export) for anything worth keeping. They won't move across.
2. **Delete the account in the app**: Settings → Account → Delete my account. Confirm. (This frees the number for the API. Business profile, catalogue and quick replies in the app are gone after this; the bot replaces them.)
3. In the Meta app → WhatsApp → API Setup → **Add phone number**. Enter the display name `ClubSweat Coffee Bar`, category Food & Grocery, the number, and choose SMS verification. Enter the code from the bar phone.
4. Set a **two-step verification PIN** on the number (WhatsApp Manager → Phone numbers → the number → Two-step verification). Store it in the password manager.
5. Copy the new **Phone number ID** and update the secret:

```bash
npx supabase secrets set WA_PHONE_NUMBER_ID=NEW_ID
```

6. Switch Yoco to live, and register the live webhook:

```bash
npx supabase secrets set YOCO_SECRET_KEY=sk_live_...
curl -X POST https://payments.yoco.com/api/webhooks \
  -H "Authorization: Bearer sk_live_..." -H "Content-Type: application/json" \
  -d '{"name":"clubsweat-orders","url":"https://YOUR_PROJECT_REF.supabase.co/functions/v1/yoco-webhook"}'
npx supabase secrets set YOCO_WEBHOOK_SECRET=whsec_...   # the new secret from the response
npx supabase functions deploy whatsapp-webhook yoco-webhook pay renewals bar
```

7. Make sure the webhook subscription in the Meta app still shows **messages** subscribed (it's per app, so it should).
8. Send "hi" from your own phone to the real number. Place a real R-something order, pay it, see it on the tablet, mark it ready, get the message. Refund it in the Yoco app afterwards if you like.
9. Display name review: Meta sometimes takes a day to approve the name. Until then messages may show the raw number. Nothing else is affected.

## After

- Update the Facebook page's WhatsApp button and any ads to the bar number (it's the same number, but re-link it in the page settings since the app connection was removed).
- Put the QR posters out.
- Watch the function logs for the first day.
- Add a payment method to the WhatsApp account in Business Settings if not already done, so template messages can be billed.

## Rolling back

If something is badly wrong, you can reinstall the WhatsApp Business app and re-register the number there (you'll need the two-step PIN). Chats from the API period are in the `messages` table, not in the app.
