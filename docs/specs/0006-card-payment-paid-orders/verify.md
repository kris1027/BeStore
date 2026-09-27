# Verify: Card payment and paid orders · spec 0006 · updated 2026-09-27
_Steps derived from spec 0006 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Setup you may want first: a Stripe test key in `.env.local` (`STRIPE_SECRET_KEY=sk_test_...`), `stripe listen --forward-to localhost:3000/api/stripe/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired`, and its `whsec_...` as `STRIPE_WEBHOOK_SECRET`.

## UI / manual
- [ ] Add a product (stock 5) twice to the cart, open `/checkout`, type ` Ada@Example.COM `, press Pay → the browser lands on `checkout.stripe.com`; one `pending_payment` order exists with email `ada@example.com`, `currency` = `STORE_CURRENCY`, `shipping_cents` 0, one `created` event, and `stripe_checkout_session_id` set → AC-1
- [ ] On Stripe's page, the line names, quantities and total match the order row; the email is prefilled; the page expires about 30 minutes out → AC-1
- [ ] Type `not-an-email` and press Pay → "Enter a valid email address." under the field, no new order → AC-2
- [ ] Set the variant's stock to 0, press Pay on an open `/checkout` → sent to `/cart` with "Sold out", no new order → AC-2
- [ ] Price a product at 0.30 (EUR store), put one in the cart, press Pay → "Your total is below the minimum card payment of €0.50…", no order → AC-2
- [ ] Pay with `4242 4242 4242 4242` → `/checkout/complete` shows "Thank you for your order", the number, the lines, the total and `a•••@example.com`; stock dropped by 2; the cart is gone (header shows an empty cart) → AC-4, AC-11
- [ ] Right after paying, reload `/checkout/complete` before `stripe listen` delivers (pause it) → "Confirming your payment", refreshing every 3 seconds; after 60 seconds "This is taking longer than usual" with the order number → AC-11
- [ ] Pay with the declined card `4000 0000 0000 0002` → Stripe shows the decline; no paid order, stock unchanged → AC-6
- [ ] Press "Back" (or the cancel link) on Stripe's page → `/checkout?cancelled=1` shows "Payment was not completed. Your cart is saved." and the cart is unchanged → AC-10
- [ ] Press Pay, come back without paying, press Pay again → the first order is `expired` ("Replaced by a new checkout"), its Stripe session is expired in the dashboard, one new pending order → AC-9
- [ ] Open `/checkout` in two tabs and press Pay in both at once → one pending order; the other tab says "Checkout is already starting in another tab…" → AC-9
- [ ] Open `/checkout/complete?session_id=cs_test_nope` and `?session_id=garbage` → "Payment not completed" with a link to `/checkout`; response headers carry `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` → AC-11
- [ ] As an admin, open `/admin/orders` → "Orders" in the nav; paid orders newest first with number, date in `STORE_TIMEZONE`, email, status, item count, total; pending and expired hidden until "All orders" → AC-12
- [ ] With more than 50 paid orders, "Older orders" shows the next 50; a new order arriving meanwhile does not shift that page → AC-12
- [ ] Open an order → lines from the snapshot (name, variant, SKU, unit price, quantity, line total), subtotal, shipping, total, email, created and paid times, Stripe links opening the test dashboard, and the event history → AC-13
- [ ] Open `/admin/orders/99999` → "Order not found" inside the admin shell → AC-13
- [ ] Signed out, open `/admin/orders` → sent to sign in; signed in as a non admin → a real 404 → AC-14
- [ ] Tab through `/checkout`, `/checkout/complete`, `/admin/orders` and an order page → every control reachable with visible focus; errors and state changes are announced; axe reports nothing → AC-18

## Commands
- [ ] `curl -i -X POST localhost:3000/api/stripe/webhook -d '{}'` → 400, no `stripe_events` row → AC-3
- [ ] `stripe trigger checkout.session.completed` (no `order_id` metadata) → 200 `not_ours`, recorded in `stripe_events`, nothing else changes → AC-16
- [ ] `stripe events resend <evt_id>` for a paid order's event → 200 `duplicate`; stock and events unchanged → AC-5
- [ ] With stock 2, pay for 3 (lower the stock after checkout starts) → order `paid`, stock 0, `needs_attention`, one `stock_shortfall` event naming the SKU short by 1; the admin page shows the banner → AC-7
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/reconcile-orders` → JSON counts; a wrong or missing header → 401 → AC-15
- [ ] Make a pending order older than 90 minutes whose paid event never arrived (stop `stripe listen`, pay, backdate `created_at`), run the cron → order `paid` once; run it again → nothing changes → AC-15
- [ ] `grep -E '"event":"(checkout|stripe|order|cron)\.' ` in the server log after a full payment → `checkout.started`, `stripe.event.processed`, `order.paid`; no email address anywhere → AC-17
- [ ] Remove `STRIPE_SECRET_KEY` from `.env.local` and run `pnpm dev` → the server refuses to start and names the variable → AC-19
- [ ] `pnpm test && pnpm test:db` → green (webhook, checkout, reconcile, confirmation and admin suites) → AC-1 to AC-17
- [ ] `STRIPE_E2E=1 pnpm test:e2e --grep @stripe --project desktop` with `stripe listen` running → both hosted page tests pass → AC-4, AC-6

## Value sourcing
- [ ] Change a variant's price after it is in the cart, then press Pay → the order line and Stripe charge the new database price, never an old or browser value → startCheckout prices
- [ ] Rename the product after checkout starts → the order line keeps the old name and SKU (snapshot) → `order_lines.product_name`, `sku`
- [ ] A variant with a color specific image → the order line's `image_path` is that image; a product with no images → null → `order_lines.image_path`
- [ ] A variant with options Size M, Color Navy → `variant_label` = `M / Navy`; a default variant → null → `order_lines.variant_label`
- [ ] Two orders in a row → numbers 1001 style, one apart, from the sequence → `orders.number`
- [ ] Set `STORE_CURRENCY=PLN` (and the minimum rule follows: 2.00 PLN) → order `currency` PLN, Stripe session in `pln` → `orders.currency`, minimum charge
- [ ] Pay, then compare `paid_at` with the Stripe event's `created` → equal (event time, not server time) → `paid_at`
- [ ] `stripe_payment_intent_id` equals the session's `payment_intent` in the dashboard → payment intent id
- [ ] Charge a different amount (edit `amount_total` in a signed test event) → paid, `needs_attention`, a `note` with both amounts → amount check
- [ ] An order paid at 23:30 UTC shows the next day in the admin list when `STORE_TIMEZONE=Europe/Warsaw` → dates
- [ ] Item count in the admin list equals the sum of line quantities (2 + 3 → 5) → item count
- [ ] Order detail Stripe links go to `dashboard.stripe.com/test/...` with a test key and without `test/` with a live key → dashboard link
- [ ] A pending order 89 minutes old is not touched by the cron; 91 minutes old is → reconcile "older than"
- [ ] `k•••@gmail.com` for `kris@gmail.com` on the confirmation page → masked email

## Acceptance-criteria coverage
- AC-1 UI 1, 2; Commands `pnpm test` · AC-2 UI 3 to 5 · AC-3 Commands 1 · AC-4 UI 6 · AC-5 Commands 3 · AC-6 UI 8; @stripe · AC-7 Commands 4 · AC-8 Value sourcing amount check · AC-9 UI 10, 11 · AC-10 UI 9 · AC-11 UI 6, 7, 12 · AC-12 UI 13, 14 · AC-13 UI 15, 16 · AC-14 UI 17 · AC-15 Commands 5, 6 · AC-16 Commands 2 · AC-17 Commands 7 · AC-18 UI 18 · AC-19 Commands 8
