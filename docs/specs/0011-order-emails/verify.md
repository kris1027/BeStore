# Verify: Order emails · spec 0011 · updated 2026-10-14
_Steps derived from spec 0011 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Pay a test order through Stripe test mode (`stripe listen` running) → one `email_sends` row `order_confirmation:<orderId>` appears, then becomes `sent` within seconds; the log shows `email.sent` with `transport: "log"` → AC-1, AC-8, AC-16
- [x] Replay the same `checkout.session.completed` event (`stripe events resend <id>`) → still one confirmation row → AC-1
- [x] Pay an order whose amount does not match (flagged on payment) → it still gets a confirmation row → AC-1
- [x] Cancel a pending order, then let a late payment land → no email row → AC-1
- [x] Admin: Mark shipped with carrier and tracking → one `order_shipped` row; Undo, ship again, Edit tracking, Mark delivered → still one row → AC-2
- [x] Partial refund from the admin page → one `order_refunded` row with `refund_id` set and `cancelled_wording = false` → AC-3
- [x] Cancel a paid order (full refund) → its refund row has `cancelled_wording = true` → AC-3
- [x] Partial refund in the Stripe dashboard on a cancelled order → row with `cancelled_wording = false` → AC-3
- [x] Run `pnpm email:dev`, open http://localhost:3001 → all three templates render with fixture props, one column, the store name as text, no images or links → AC-4 to AC-7, AC-16
- [x] Confirmation preview: subject `Order #1042 confirmed`, "Hi Anna,", lines with unit price and line total, subtotal, delivery, total, address, "We'll email you when your order ships." → AC-4
- [x] Shipped preview: "Carrier: InPost, tracking number: …", items, address → AC-5
- [x] Refund preview: amount, refunded items, the 5 to 10 business days line, no reason → AC-6
- [x] Every email ends with "Questions? Reply to this email or write to <EMAIL_FROM address>." and has no Reply-To header → AC-7
- [x] Order page shows an "Emails" section, newest first, with kind, status words and attempt count; an order with none says "No emails sent for this order." → AC-13
- [x] Set a row to `failed` / `gave_up` in the DB → "Failed: Gave up after 23 hours, it may have been sent" and a Send again button; the confirm warns about a duplicate and says it will not be sent twice within 24 hours → AC-13, AC-14
- [x] Confirm Send again → toast, history note "Order confirmation email queued again" with the admin's name, row ends `sent`; the attention flag stays on → AC-14
- [x] Send again works by keyboard alone on desktop and phone, focus goes into the dialog and back to the trigger, axe passes → AC-18
- [x] Sign out, or use an admin below `aal2`, and post `sendEmailAgain` → spec 0004 behaviour, row unchanged → AC-15

## Commands
- [x] `pnpm test` → all pass, including `src/lib/email/classify.test.ts`, `src/lib/email/render.test.ts`, `src/features/orders/email-status.test.ts`, `src/lib/env.test.ts` (email block) → AC-4 to AC-7, AC-9, AC-13, AC-16
- [x] `pnpm test:db` → all pass, including `tests/db/order-emails.db.test.ts` (26 tests) → AC-1 to AC-3, AC-8 to AC-12, AC-14, AC-15, AC-17
- [x] `pnpm test:e2e tests/e2e/admin/order-emails.spec.ts` → desktop and mobile pass → AC-13, AC-14, AC-18
- [x] `EMAIL_TRANSPORT=log VERCEL_ENV=production pnpm build` → fails on `EMAIL_TRANSPORT` → AC-16
- [x] `EMAIL_TRANSPORT=resend` with no `RESEND_API_KEY` → the server refuses to start, naming `RESEND_API_KEY` → AC-16
- [x] `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/reconcile-orders` with a `pending` row queued 10 minutes ago → row `sent`, `cron.email_sweep` logged with counts → AC-11
- [x] Same with a `pending` row whose `queued_at` is 24 hours ago → row `failed` / `gave_up`, order flagged, one system note; a second run writes no second note → AC-11
- [x] Set an order's email to null (purged expired order) with a pending refund row, run the cron → row `failed` / `email_missing`, a note, no flag, `order.email_missing` logged → AC-12
- [x] Grep the logs of a full run for the customer's email, name, street or subject → no match → AC-17
- [x] With a real Resend test key and `EMAIL_TRANSPORT=resend`, send to `delivered@resend.dev` → row `sent` with a `resend_id`; to an invalid address → `failed` / `validation_error`, order flagged → AC-8, AC-9

## Value sourcing (each value's source, with the edge that breaks if it is wrong)
- [x] Recipient: change `orders.email` after paying but before delivery → the email goes to the new address (read at send time) → AC-12
- [x] Sender: set `EMAIL_FROM=Shop Name <hi@shop.test>` → From shows it and the footer shows `hi@shop.test` → AC-7
- [x] Idempotency key: the Resend request carries `Idempotency-Key: <dedupe_key>` → AC-8
- [x] Store name: change `brand.name` → the wordmark changes → AC-7
- [x] Date paid: pay at 23:30 UTC with `STORE_TIMEZONE=Europe/Warsaw` → the email shows the next day → AC-4
- [x] Lines: edit the product's name after paying → the email shows the order line snapshot, not the new name → AC-4
- [x] Money: set `STORE_LOCALE=pl-PL` and a PLN order → amounts read "10,00 zł" and `<html lang="pl-PL">` → AC-4, AC-7
- [x] Delivery: an order with `shipping_cents = 0` shows "Free"; with a discount above 0 shows "Discount" → AC-4
- [x] Address: an order made before spec 0007 (no `ship_*` columns) has no address section → AC-4, AC-5
- [x] Carrier and tracking: Edit tracking before the shipped email sends → it carries the new values → AC-5
- [x] Refund amount and delivery: refund with "Refund delivery" ticked → "Delivery fee refunded" shows → AC-6
- [x] Refund items: a refund with no lines (dashboard refund) shows no items table → AC-6
- [x] Cancel wording: a cancelled order with a partial refund keeps the plain subject → AC-3, AC-6
- [x] Greeting: `customer_name` "  Ada  Lovelace" → "Hi Ada,"; null → "Hello," → AC-4
- [x] Emails section: a refund row shows "Refund <amount>" from the refund's own amount; `sent_at` shows in `STORE_TIMEZONE` → AC-13
- [x] Send again: the history note names the signed in admin → AC-14
- [x] Sweep constants: a row queued 1 minute ago is left alone; a 429 stops the run after one try → AC-11
- [x] In process retry: a 500 then success sends on the second try about 5 seconds later → AC-8

## Before launch
- [ ] Resend dashboard → Domains → the sending domain → Configuration: open tracking and click tracking both off → AC-7

## Acceptance criteria coverage
- AC-1 webhook steps, db tests · AC-2 ship steps · AC-3 refund steps · AC-4 to AC-7 preview and render tests · AC-8 webhook, in process retry, Resend key · AC-9 classify tests, Resend test key · AC-10 db race test · AC-11 cron steps · AC-12 purged email step · AC-13 Emails section · AC-14 Send again · AC-15 auth step · AC-16 env steps and transports · AC-17 log grep · AC-18 e2e with axe
