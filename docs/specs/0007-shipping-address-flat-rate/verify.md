# Verify: Shipping address & flat rate · spec 0007 · updated 2026-09-30
_Steps derived from spec 0007 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Before you start: `STORE_COUNTRY=PL` in `.env.local`, the local Supabase stack up, `pnpm dev` running, and for the Stripe steps `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Change the fee and threshold only through `/admin/settings` (a direct database write skips the `store-settings` cache tag, so the cart would keep showing the old fee).

## UI / manual
- [ ] Add a product to the cart, open `/checkout` → Email, Full name, Address line 1, Address line 2 (optional), Postal code, City, Phone (optional) each have a visible label and the autocomplete tokens `email`, `shipping name`, `shipping address-line1`, `shipping address-line2`, `shipping postal-code`, `shipping address-level2`, `tel`; the country shows as the text "Poland", with no input → AC-1
- [ ] On `/checkout` type the email, leave Full name as spaces, postal code `00 950`, phone `123`, press Pay → each field shows its own message from the Validation messages table, focus lands on Full name, nothing leaves the page → AC-2
- [ ] Postal code `00950` with a valid address → the order row stores `00-950`; `0095`, `ABCDE` and `00–950` (en dash) are refused → AC-2
- [ ] In `/admin/settings` set fee `9.99`, free delivery from `50`; with a €25.00 cart, `/checkout` shows Subtotal €25.00, "Standard delivery" €9.99, Total €34.99 and `Pay €34.99` → AC-4
- [ ] Same settings, cart at exactly €50.00 → `/checkout` shows "Free delivery" with "Free" and `Pay €50.00`; at €49.99 it charges €9.99 → AC-3, AC-4
- [ ] Set fee `0` with free delivery off → every cart shows "Free delivery" → AC-3
- [x] Press Pay with a valid address → the new `pending_payment` order holds `ship_full_name`, `ship_line1`, `ship_line2` (null when empty), `ship_city`, `ship_postal_code`, `ship_country_code = PL`, `phone` (null when empty), `shipping_cents` and `total_cents = subtotal + shipping` → AC-5
- [ ] A €0.30 product with a €1.00 fee → Pay succeeds (total €1.30 clears the Stripe minimum); with a fee of 0 it is refused as below the minimum → AC-5
- [x] On Stripe's hosted page → one shipping line "Standard delivery" (or "Free delivery") at the order's fee, and the total equals the order's `total_cents`; after paying, the webhook marks it paid with no `needs_attention` → AC-6
- [x] In the Stripe dashboard, the payment intent's shipping shows the name, address and phone; line 2 and phone are absent (not blank) when left empty → AC-6
- [ ] Load `/checkout` at fee 5.00, then change the fee to 9.00 in `/admin/settings`, then press Pay on the open page → the order and Stripe's page both use 9.00; no error shows → AC-7
- [ ] `/cart` with a threshold not yet met → the delivery row, Total including delivery, and "Add €X more for free delivery" where X = threshold − subtotal; the old "Shipping is added at checkout" line is gone → AC-8
- [ ] Press Pay, then cancel on Stripe → back on `/checkout?cancelled=1` every field is filled with what you typed; a fresh browser with a new cart shows empty fields → AC-9
- [ ] The admin sidebar has "Settings"; `/admin/settings` shows Delivery fee `0.00` by default and Free delivery from disabled until "Offer free delivery" is checked → AC-10
- [ ] In `/admin/settings` enter `9,99` → "Enter an amount like 9.99."; `1000.01` → "Delivery fee can be at most 1,000.00."; threshold `0` → "Enter an amount above 0."; `100000.01` → "Free delivery threshold can be at most 100,000.00." → AC-10
- [ ] Save valid settings → "Shipping settings saved." shows, a reload shows the saved values as plain decimals, and `/cart` shows the new fee on its next load → AC-10
- [ ] Uncheck "Offer free delivery" with a value still in the field and save → `free_shipping_threshold_cents` is null → AC-10
- [ ] Signed out, open `/admin/settings` → redirected to sign in; as a signed in non admin → 404 → AC-10
- [ ] `/admin/orders/<number>` of a new order → Details shows a "Delivery address" block (name, line 1, line 2 when set, postal code and city, Poland), the phone when set, and the totals row labelled "Standard delivery" or "Free delivery"; an order from before this feature shows "No address recorded" → AC-11
- [x] `/admin/orders` → a "Ship to" column with "Anna Kowalska, Warsaw", or "Not recorded" for an older order → AC-12
- [ ] `/checkout/complete` for a paid order → a delivery row between Subtotal and Total paid, and a "Delivering to" block with the name and address; an order from before this feature has no such block → AC-13
- [ ] After a checkout and a settings save, read the dev server log → `checkout.started` carries `shippingCents`; `settings.shipping_updated` carries `adminId`, `from` and `to`; `checkout.refused` for a validation error lists only field names; no name, address line, postal code or phone appears anywhere → AC-14
- [x] Remove `STORE_COUNTRY` (or set it to `DE`) and start the server → it refuses to start and names `STORE_COUNTRY` → AC-15
- [ ] Walk `/checkout`, `/cart`, `/admin/settings`, `/admin/orders` and `/admin/orders/<number>` by keyboard only → every control is reachable with visible focus; axe reports no violations → AC-16

## Value sourcing (one step per row)
- [ ] `shipping_cents` at Pay: change the fee between page load and Pay → the order uses the fee read inside the order transaction, not the page's → Value sourcing: startCheckout `shipping_cents`
- [x] `ship_*`, `phone`: type `  Anna Kowalska ` and ` m. 4 ` → stored trimmed; an empty line 2 or phone stored as null → Value sourcing: startCheckout `ship_*`, `phone`
- [ ] `ship_country_code`: send `countryCode: "DE"` in a crafted `startCheckout` call → stored `PL` from `STORE_COUNTRY` → Value sourcing: startCheckout `ship_country_code`
- [ ] `total_cents`: send `shippingCents: 0` or `totalCents: 1` in a crafted call with a fee set → the order's total is subtotal − discount + the database fee → Value sourcing: startCheckout `total_cents`
- [ ] Stripe shipping rate amount and name: an order with fee 0 → rate amount 0 named "Free delivery"; fee 1500 → 1500 named "Standard delivery" → Value sourcing: Stripe session shipping rate
- [ ] Stripe shipping rate currency: set `STORE_CURRENCY=PLN` → the rate currency is `pln` → Value sourcing: Stripe session currency
- [x] `payment_intent_data.shipping`: an order without line 2 and phone → those keys are missing, never `""` → Value sourcing: Stripe session `payment_intent_data.shipping`
- [x] `/checkout` country text: set `STORE_LOCALE=pl` → the country shows "Polska" → Value sourcing: `/checkout` country text
- [ ] `/checkout` prefill: two orders on one cart → the newest (created_at desc, id desc) fills the form; another cart's order never does → Value sourcing: `/checkout` prefill
- [ ] `/cart` gap: threshold 200.00, subtotal 150.00 → "Add €50.00 more for free delivery"; at 200.00 no nudge → Value sourcing: `/cart` gap
- [ ] `/admin/settings` current values: a threshold of 5 cents shows `0.05`, a fee of 1200 shows `12.00` → Value sourcing: `/admin/settings` current values
- [ ] `updateShippingSettings` cents: save `12.5` → stored 1250 → Value sourcing: `updateShippingSettings` cents
- [ ] `discountCents` for the rule: 0 on the cart, checkout and order until feature 14 → Value sourcing: `discountCents`
- [x] "Ship to": an order with name and city → "Name, City" → Value sourcing: admin list "Ship to"
- [ ] Admin and complete page labels: `deliveryLabel(order.shipping_cents)`, never the current settings; change the fee after an order is paid → its pages keep its own label and amount → Value sourcing: admin order pages, complete page
- [x] `settings.shipping_updated` old and new: save twice → the second log's `from` equals the first save's `to` → Value sourcing: log

## Commands
- [x] `pnpm test` → all unit suites pass, including `src/lib/shipping/*.test.ts`, `src/features/settings/schemas.test.ts`, `src/features/checkout/*.test.ts` → AC-2, AC-3, AC-6, AC-10, AC-15
- [x] `pnpm test:db` → all DB suites pass, including `tests/db/start-checkout.db.test.ts` (delivery block) and `tests/db/shipping.db.test.ts` → AC-5, AC-6, AC-7, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14
- [x] `pnpm test:e2e tests/e2e/checkout tests/e2e/admin/settings.spec.ts` → all pass (the settings spec runs on desktop only, one test at a time) → AC-1, AC-2, AC-4, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-16
- [x] `pnpm lint && pnpm typecheck && pnpm format:check` → clean

## Acceptance-criteria coverage
- AC-1 UI step 1, e2e delivery.spec · AC-2 UI steps 2 and 3, unit address and schemas tests · AC-3 UI steps 5 and 6, unit rule tests · AC-4 UI steps 4 and 5 · AC-5 UI steps 7 and 8, Value sourcing rows 1 to 4 · AC-6 UI steps 9 and 10, Value sourcing rows 5 to 7 · AC-7 UI step 11 · AC-8 UI step 12 · AC-9 UI step 13 · AC-10 UI steps 14 to 18 · AC-11 UI step 19 · AC-12 UI step 20 · AC-13 UI step 21 · AC-14 UI step 22 · AC-15 UI step 23 · AC-16 UI step 24
