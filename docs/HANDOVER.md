# ClubSweat coffee bar: how the WhatsApp ordering works

This is for the owner and the baristas. No technical knowledge needed.

## What customers see

1. They scan the QR poster or save the bar number and send "hi".
2. They get three buttons: **My usual**, **See menu**, **My pass**.
3. They pick a drink, size and milk, then tap **Checkout**.
4. If they have a coffee pass, it's paid instantly. If not, they get a **Pay** button that opens Yoco (card, Apple Pay, Google Pay). Nothing is made until the payment lands.
5. They get "Order 7F2A is in, ready in about 6 minutes."
6. When you tap **Ready** on the tablet, they get "Order 7F2A is ready at the counter."

Customers can also just type: "2 flat whites, one oat milk". Replying **pass** shows their balance or lets them buy a pass. Replying **cancel** clears their order.

## The tablet (barista screen)

Sign in once with the bar email and password. Four tabs at the top:

**Orders** has three columns.

- **New** (red dot): paid orders that nobody has started. A chime plays when one arrives. Tap **Start making**.
- **Making** (amber dot): tap **Ready, notify** the moment it's on the counter. That sends the customer their message.
- **Ready to collect** (green dot): tap **Collected** when they've taken it. The card disappears.

The big code (like 7F2A) is what the customer sees too. Write it on the cup. The timer turns amber after 10 minutes. The solid white button on each card is always the one thing to do next.

**Inbox** shows every customer conversation. You can reply as the bar. One rule from WhatsApp: you can only send a free message within 24 hours of the customer's last message. If it's been longer, the app tells you and the customer needs to message first.

**Menu** lets you change prices and switch items off when you run out (and back on). Adding brand-new items or milk options is done in the database by whoever set the system up; send them the details.

**Settings** has the open/closed switch, the prep time shown to customers, and the message customers get when you're closed. The green **Taking orders** pill at the top is the same switch; tap it to close the bar when you're slammed or at the end of the day. Closed means the bot replies with the closed message and takes no orders.

## Coffee passes (memberships)

Customers buy a pass in WhatsApp (reply **pass**). Two kinds:

- **Coffee passes** (10 or 20 coffees): each coffee order uses one credit, including size and milk extras. Valid for a set number of days.
- **Daily pass**: one coffee a day for 30 days.

Two days before a pass runs out, the customer automatically gets a reminder with a pay link to renew. Unused coffees roll over when they renew. Passes cover the Coffee category only; smoothies and extras are paid by card.

The Settings tab shows how many passes are active.

## Money

All card payments land in the gym's Yoco account next to the card machine takings. Each WhatsApp order shows in the Yoco app with the order code in its description, so matching is easy.

Refunds: do them in the Yoco app (find the payment, tap refund). Then tap **Cancel** on the order card on the tablet. The system doesn't refund by itself.

## Daily routine

- Morning: open the tablet app, tap the screen once (that turns the chime on), check the pill says **Taking orders**.
- During the day: New → Start making → Ready → Collected. Keep it moving; the customer messages depend on it.
- End of day: tap the pill so it says **Closed**. Orders can't be placed overnight.
- The bar phone: keep it charged. It receives a WhatsApp copy of every new order as a backup if the tablet is off. Send it the word **open** once a day so WhatsApp keeps letting the system message it freely.

## Office push ideas that work with this system

- QR posters in office kitchens (see the poster folder). Each poster opens a chat with "Hi, I'd like to order".
- "Order by 08:45, collect 09:00" morning runs for the buildings next door.
- Meta ads with a WhatsApp button targeted at a 1 km radius on weekday mornings. Every tap becomes a customer in the system.
- Mention the pass on the counter: "Buy 10, skip the queue and the card machine."

## If something looks wrong

- No chime: tap the screen once. Browsers block sound until the first tap.
- A customer says they paid but nothing shows: check the Yoco app for the payment. If it's there, the order will usually arrive within a minute; if not, tell the technical contact the order code and the time.
- Customer didn't get a "ready" message: check the Inbox tab for a red failed line, and ask them to send "hi" so the 24-hour window reopens.
- The tablet is off or broken: the bar phone still gets every order by WhatsApp. Make the drinks from there and tell customers at the counter.

Technical contact: Joe (LinkSolar), joe@linksolar.co.za.
