# WhatsApp message templates

Submit each one in WhatsApp Manager → Account tools → Message templates → Create. Category **Utility** for all of them, language **English**. Names must match exactly (the code sends them by name).

Templates are only used when the 24-hour customer window is closed. Inside the window the bot sends normal text, so the templates can be approved after launch without blocking anything except the renewal reminders.

Variables are `{{1}}`, `{{2}}` etc. Meta asks for sample values; use the ones shown.

---

## order_confirmed

Body:

```
Thanks {{1}}! Order {{2}} is in and paid. Ready in about {{3}} minutes at the ClubSweat bar. We'll message you when it's at the counter.
```

Samples: `Jan` · `7F2A` · `6`

## order_ready

Body:

```
{{1}}, order {{2}} is ready at the ClubSweat bar counter. Enjoy!
```

Samples: `Jan` · `7F2A`

## pass_activated

Body:

```
Thanks {{1}}, your {{2}} is active. Reply hi whenever you want a coffee and it comes straight off your pass.
```

Samples: `Jan` · `10 Coffee Pass`

## pass_renewal

Body:

```
Hi {{1}}, your {{2}} ends on {{3}}. Renew now for {{4}} and any unused coffees roll over. Tap below to pay securely with Yoco.
```

Samples: `Jan` · `10 Coffee Pass` · `Friday 14 November` · `R320`

Button: type **Call to action → Visit website → Dynamic**.
URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/pay/{{1}}`
Sample for the URL variable: `8d1f4c2e-3b7a-4e2f-9c1d-123456789abc`
Button text: `Renew my pass`

Footer (optional): `Reply STOP to turn off reminders`

## staff_new_order

Sent to the bar phone when the tablet-free fallback is used and the phone hasn't messaged the system in 24 hours.

Body:

```
New order {{1}} from {{2}}: {{3}}
```

Samples: `7F2A` · `Jan Smit` · `1 x Flat white (Large, Oat)`

---

## Tips for approval

- Keep the wording exactly as above; marketing-sounding words ("special", "deal") can get a utility template reclassified as marketing, which costs more per message.
- The dynamic URL must have a fixed base; only the end can vary. That's why the pay links go through the `/pay/` function on your own domain.
- If a template is rejected, read the reason in WhatsApp Manager, tweak, resubmit. The code doesn't care about the body text, only the name and the number of variables.
