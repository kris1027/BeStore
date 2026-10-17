# Verify: Discounts & promo codes · spec 0014 · updated 2026-10-17
_Steps derived from spec 0014 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] On `/checkout`, type a valid code in lowercase with spaces, press Apply → the field shows it uppercased, a "Discount (CODE)" row shows a negative amount, Remove replaces Apply, and the Pay button total equals the Total row → AC-1
- [ ] Press Enter in the code field → Apply runs; the page stays on `/checkout` and the payment form shows no errors → AC-1
- [ ] Press Remove → the discount row goes, the totals go back, focus returns to the empty field → AC-1
- [ ] Set a flat fee of 15.00 and a free delivery threshold of 50.00, put 52.00 of items in the cart, apply a 10% code → the discount is trimmed to 2.00 so delivery stays free; the total is never above the total without a code → AC-2
- [ ] Apply a fixed code worth more than the cart with no delivery fee → the total stays at the Stripe minimum (0.50 EUR) → AC-2
- [ ] Apply, one at a time: an unknown code, `10% off`, an inactive code, a code that has not started, an expired code, a used up code, a code with a minimum subtotal above the cart, a code this email already used, and a code the caps leave at 0 → each shows exactly its AC-3 message under the field, linked by `aria-describedby`, focus stays in the field, and the live region announces it → AC-3
- [ ] As a guest, apply a per customer limited code with the email field empty → it applies; type the email that used it and apply again → "You've already used this code." → AC-3
- [ ] Apply a code, deactivate it in `/admin/discounts/[id]`, then press Pay → "This code isn't valid." under the field, focus there, the discount row gone, every form field kept, and no new order for the cart → AC-4
- [ ] Pay with a code (Stripe test mode) → Stripe's page shows the coupon under the code's name and the same total as our summary; the order has the code snapshot, line discounts that sum to the order discount, and one redemption → AC-4, AC-6, AC-7, AC-15
- [ ] Two browsers race for a code with one use left → exactly one reaches Stripe; the other sees "This code has been used up." → AC-5
- [ ] Leave Stripe's page with the back link → `/checkout` shows the code still applied with the same totals → AC-9
- [ ] Wait for the pending order to expire (or cancel it in the admin) → its redemption is gone and the code's use count drops → AC-8
- [ ] `/admin/discounts` → the Discounts nav entry is there; the list shows code, discount ("10%" or "€5.00 off"), status, uses ("1 / 5" or "1"), starts, ends ("No end"), discount given and an Orders link; search and the status filter narrow it → AC-10
- [ ] `/admin/discounts/new` submitted empty → each field shows its message and the first gets focus; a duplicate code shows "A code with this name already exists." on Code → AC-11
- [ ] Open a used code → Code, type and value are read only with "Locked after first use."; lowering the total limit below the uses saves and shows Used up; a save from a page opened before another save shows the stale message → AC-12
- [ ] A never used code offers Delete with a confirm dialog; a used one has no Delete → AC-13
- [ ] "Orders with this code" → `/admin/orders?discount=<id>` shows only those orders and a removable chip; `?discount=not-a-uuid` is ignored; the order page shows "Discount (CODE, 10%)" linking to the code → AC-14
- [ ] `/checkout/complete`, `/account/orders/[number]` and the confirmation email of a discounted order show "Discount (CODE)" with the amount → AC-15
- [ ] On a discounted paid order, choose every unit plus delivery in the refund form → the suggestion equals the order total; a single line suggests its discounted line total → AC-16
- [ ] A signed out visitor is sent to sign in, and a signed in customer gets the store 404, on all three `/admin/discounts` pages → AC-17
- [ ] Run axe and a keyboard pass on `/checkout` with a code applied and refused, on `/admin/discounts`, and on the new and edit forms → no violations, everything reachable by Tab → AC-20

## Value sourcing
- [ ] Change a variant's price after Apply, then Pay → Pay charges the new price with the discount computed on it (cart lines come from the DB, never the browser) → Value sourcing: cart lines and subtotal
- [ ] Change the delivery fee in `/admin/settings` after Apply, then Pay → Stripe's total uses the new fee → Value sourcing: delivery and total
- [ ] Switch `STORE_CURRENCY` to PLN on a dev run → the minimum cap keeps the total at 2.00 PLN → Value sourcing: Stripe minimum
- [ ] Signed in, type another email in the browser devtools and apply a per customer code the account email already used → refused (the account email wins) → Value sourcing: the email for check 5
- [ ] Apply on a cart whose own pending order holds the code's last use → it still applies; another cart is refused → Value sourcing: redemption counts
- [ ] Set a code's end to one minute from now in the store time zone, wait past it → Apply says "This code has expired." (the database clock decides) → Value sourcing: now for dates
- [ ] A code with a 50.00 minimum on a 20.00 cart → "Add €30.00 more to use this code." → Value sourcing: Add <amount> more
- [ ] Pay → the order's `discount_cents`, line split and totals match what `snapshotOrder` computes inside the order transaction → Value sourcing: discount, line split, totals
- [ ] Pay as a guest with `Ada@Example.com` → the redemption email is `ada@example.com` → Value sourcing: order email for the redemption
- [ ] Rename nothing, then compare the order's `discount_code`, `discount_type`, `discount_value` with the code row → identical → Value sourcing: snapshot columns
- [ ] In the Stripe dashboard, the coupon `order_<id>` has `amount_off` = `discount_cents`, currency EUR, name = the code → Value sourcing: coupon fields
- [ ] Come back to `/checkout` 25 hours after a Pay with a code → the code is no longer prefilled → Value sourcing: checkoutPrefill code
- [ ] A pending order older than 35 minutes does not count in the list's uses → Value sourcing: uses
- [ ] Discount given sums only paid orders with the code → Value sourcing: discount given
- [ ] Enter a start of 2026-07-01 09:30 with `STORE_TIMEZONE=Europe/Warsaw` → stored as 07:30 UTC and shown back as 09:30 → Value sourcing: dates shown and parsed
- [ ] `created_by_admin_id` and `updated_by_admin_id` are the signed in admin → Value sourcing: admin ids
- [ ] After deleting an unused code that an expired order pointed at, the order page shows the snapshot text without a link → Value sourcing: admin order page discount row

## Commands
- [ ] `pnpm test` → all unit tests pass (rule, schema, dates, snapshot, session params, list params, email) → AC-2, AC-3, AC-6, AC-7, AC-11
- [ ] `pnpm test:db tests/db/discounts-checkout.db.test.ts tests/db/discounts-admin.db.test.ts tests/db/orders.db.test.ts` → pass → AC-3 to AC-5, AC-8 to AC-14, AC-16, AC-18, AC-19
- [ ] `pnpm test:e2e tests/e2e/checkout/discounts.spec.ts tests/e2e/admin/discounts.spec.ts` → pass on desktop and mobile → AC-1, AC-3, AC-4, AC-9 to AC-15, AC-17, AC-20

## Acceptance-criteria coverage
- AC-1 UI 1 to 3 · AC-2 UI 4, 5 · AC-3 UI 6, 7 · AC-4 UI 8, 9 · AC-5 UI 10 · AC-6 UI 9 · AC-7 UI 9 · AC-8 UI 12 · AC-9 UI 11 · AC-10 UI 13 · AC-11 UI 14 · AC-12 UI 15 · AC-13 UI 16 · AC-14 UI 17 · AC-15 UI 18 · AC-16 UI 19 · AC-17 UI 20 · AC-18 db suites (log assertions) · AC-19 orders.db suite · AC-20 UI 21
