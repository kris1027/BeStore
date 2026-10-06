# Verify: admin order management · spec 0010 · updated 2026-10-05
_Steps derived from spec 0010 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

Sign in as an admin at `aal2`. Seed a paid order (or pay one through checkout with `stripe listen` running, events listed in `tests/e2e/checkout/stripe-hosted.spec.ts`).

- [x] `/admin/orders`, type the order number in "Order number, email or name", press Enter → only that order shows, `q=<number>` is in the URL → AC-1
- [x] Search part of an email in another case (`ADA@`), part of a name, then `50%` → substring matches only; `50%` matches literally, not `50` followed by anything → AC-1
- [x] Pick Status "Shipped", tick "Needs attention only", Refunds "Partly refunded", a from/to date, Find orders → the filters combine, sit in the URL, survive "Older orders" and a reload → AC-2
- [x] Open `/admin/orders?status=lost&from=2026-02-30&before=abc` and `/admin/orders?from=2026-10-02&to=2026-10-01` → no error, the bad values are ignored → AC-2
- [x] Open the old `/admin/orders?view=all` → every order, pending and expired included → AC-2
- [x] Search for something that matches nothing → "No orders match these filters." with a "Clear filters" link → AC-3
- [x] Paid order → "Mark shipped" with carrier DHL and tracking X1 → status Shipped, history (newest first) shows "Carrier: DHL, tracking: X1" with your name → AC-4, AC-21
- [x] "Mark delivered" → Delivered, with your name in the history → AC-5
- [x] "Undo" without a reason → field error linked to the field; with a reason → back to Shipped; Undo again → Paid, carrier and tracking kept and prefilled in "Mark shipped" → AC-6
- [x] "Edit tracking", save unchanged → "Nothing changed."; change the number → history "Tracking: X1 → X2" → AC-7
- [x] Open the order in two tabs, ship in one, then "Mark shipped" in the other → "This order changed. Reload to see the latest." and nothing changes → AC-8
- [ ] "Refund", 1 of 2 units, tick "Return to stock" → amount prefills with the line's share; Review shows amount, lines, restock and reason; Refund now → "Partly refunded", refunds section shows "1 of 1 back to stock", the product's stock history shows a "Refund return" row, the storefront stock updates → AC-9, AC-10, AC-13, AC-21
- [x] Refund form: raise the amount above the suggestion, or above what is left on a goodwill refund → field error, nothing reaches Stripe (Stripe dashboard shows no new refund) → AC-11
- [x] Refund an already fully refunded payment in Stripe's dashboard first, then refund it from the panel → "Stripe refused the refund: …", the refund shows Failed, the order is unchanged → AC-12
- [x] On an order with a shortfall (stock was 1, 2 bought), refund both with restock → only 1 comes back, history notes "Returned 1 of 2 to stock for <sku>" → AC-13
- [x] Paid order → "Cancel and refund": every line listed with "Return to stock" ticked, the full remaining amount shown; confirm → Cancelled, Fully refunded, stock back → AC-14
- [ ] Unpaid order with an open checkout → "Cancel order" → the session expires at Stripe, the order is Cancelled; with a completed but unpaid session → "A payment is in progress for this order. Wait for it to settle." → AC-15
- [x] Refund part of a paid order in the Stripe dashboard → the order shows a refund by "Stripe dashboard", counted in the refunded amount once it succeeds → AC-16
- [ ] Refund with `stripe listen` stopped and the network to Stripe blocked → "Stripe did not answer. The refund is being checked."; "Refund pending: <amount>" shows; every action but notes is refused with "A refund is in progress for this order."; after 2 minutes "Check with Stripe" settles it → AC-12, AC-17, AC-18
- [x] Add a note on an expired order → shows in the history with your name → AC-19
- [x] On a flagged order, "Mark resolved" with a note → the flag clears, history shows "Marked resolved" with the note → AC-20
- [ ] Do the ship, refund and cancel steps by keyboard only: focus moves into each dialog and back to its trigger, every field is labelled, errors are announced and linked → AC-24

## Commands

- [x] `pnpm test` → refund math, allowed actions, list params, dates and refund status mapping pass → AC-1, AC-2, AC-8, AC-9, AC-11, AC-13, AC-14, AC-17, AC-18
- [x] `pnpm test:db` → `tests/db/order-status-actions.db.test.ts`, `order-refunds.db.test.ts`, `admin-orders.db.test.ts`, `stock-movements.db.test.ts`, `orders.db.test.ts` pass → AC-1 to AC-23
- [x] `pnpm test:e2e tests/e2e/admin/orders.spec.ts` → ship, deliver, undo, tracking, note and the filters by keyboard with zero axe violations, desktop and phone → AC-1 to AC-7, AC-19, AC-21, AC-24
- [x] `STRIPE_E2E=1 pnpm test:e2e tests/e2e/admin/orders.spec.ts -g @stripe` → a real test mode partial refund with restock, and a real cancel and full refund → AC-10, AC-13, AC-14
- [x] `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/reconcile-orders` with a pending refund → the body has `refundsSynced` and `refundsFailed` → AC-17
- [x] Grep the dev server log after a refund with a reason and a note → only ids, numbers and amounts; no reason, note, email, name or tracking number → AC-23

## Value sourcing

- [ ] Dates: with `STORE_TIMEZONE=Europe/Warsaw`, an order placed at 23:30 UTC on 30 September shows under `from=to=2026-10-01`, not 30 September; try a range across 25 October (the clock change) → date bounds
- [ ] Refund state: set `refunded_cents` to 0, half, and the total → the badges read Not refunded, Partly refunded, Fully refunded, and the Refunds filter agrees → refund state
- [ ] Amount: type `12.5` and `12.50` → both send 1250 cents; `12.505` → field error → `amountCents`
- [ ] Restock quantity: an order paid before spec 0009 (no sale movement) restocks 0 and notes it → restock quantity
- [x] Movement actor: the `return` row names the admin who made the refund, not the one viewing → movement `admin_id`
- [ ] `succeeded_at`: a webhook settled refund carries the event's time, an action settled one the server's time → `succeeded_at`
- [ ] Stripe call: the payment intent comes from the order row and the idempotency key is the refund id (Stripe dashboard request log) → `payment_intent`, idempotency key
- [x] In flight and "Check with Stripe": a pending refund with no Stripe id blocks actions for 10 minutes; the button appears after 2 → in flight refund, "Check with Stripe" shown

## Acceptance-criteria coverage

- AC-1 to AC-3: list UI steps, `list-params.test.ts`, `admin-orders.db.test.ts`, e2e filters
- AC-4 to AC-8: UI steps, `order-status-actions.db.test.ts`, e2e keyboard flow
- AC-9 to AC-15: UI steps, `refund-math.test.ts`, `order-refunds.db.test.ts`, e2e `@stripe`
- AC-16, AC-17: dashboard refund and sync steps, `order-refunds.db.test.ts` (webhooks, sync, cron)
- AC-18: in flight step, `order-actions.test.ts`, db tests
- AC-19 to AC-21: UI steps, db and e2e tests
- AC-22: db test (guard rejects, nothing changes); `requireAdmin()` first in every action
- AC-23: log grep step; db tests assert no reason, note, email or tracking in log calls
- AC-24: keyboard steps and e2e axe runs, desktop and phone
