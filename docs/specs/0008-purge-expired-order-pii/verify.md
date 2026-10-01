# Verify: Purge PII from expired orders · spec 0008 · updated 2026-10-01
_Steps derived from spec 0008 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Data
- [ ] Query `pg_constraint` and `pg_indexes` on the local database → `orders_email_present_check`, `orders_purge_only_expired_check`, `orders_expired_at_present_check` and `orders_purge_due_idx` exist, and `orders.email` and `orders.pii_purged_at` are nullable → AC-3
- [ ] `UPDATE orders SET pii_purged_at = now()` on a paid order → fails with SQLSTATE 23514 naming `orders_purge_only_expired_check` → AC-3
- [ ] `UPDATE orders SET email = NULL` on a pending order → fails with 23514 naming `orders_email_present_check` → AC-3
- [ ] `UPDATE orders SET status = 'expired'` without `expired_at` → fails with 23514 naming `orders_expired_at_present_check` → AC-3

## Cron
- [ ] `curl -i localhost:3000/api/cron/purge-expired-orders` with no header, and with a wrong bearer → 401 `{ "error": "unauthorized" }`, no row changes → AC-4
- [ ] Seed an expired order with `expired_at` 31 days ago and one 29 days ago, plus a paid, a shipped and a cancelled order; call the route with `Authorization: Bearer $CRON_SECRET` → 200 `{ "purged": 1 }` → AC-1, AC-2, AC-4
- [ ] On the purged row: `email`, `customer_name`, `phone`, every `ship_*` column, `cart_id` and `customer_id` are null; `pii_purged_at` and `updated_at` are now; number, totals, Stripe ids, `needs_attention`, `expired_at`, lines and events unchanged → AC-1
- [ ] Every other seeded order still holds its email and address → AC-2
- [ ] Vary the boundary: an order expired exactly 30 days ago by the database clock is not purged; 30 days and one minute is → AC-1 (Value sourcing: due rule uses Postgres `now()`)
- [ ] An expired order with `needs_attention = true`, 31 days old → purged, flag kept → AC-2
- [ ] Call the route again → `{ "purged": 0 }` → AC-5
- [ ] Fire two calls at once on a backlog → both 200, the two counts sum to the number of due rows → AC-5
- [ ] Server log for a run holds only `cron.purge_expired_orders` with `purged`; no email, name, phone, address, cart id or customer id → AC-7
- [ ] `vercel.json` lists `/api/cron/purge-expired-orders` at `0 4 * * *`; the route exports `maxDuration = 60` → AC-4
- [ ] `EXPIRED_ORDER_PII_RETENTION_DAYS = 30` is the only place the number lives, with the privacy policy comment, and no env or setting reads it → AC-10

## UI / manual
- [ ] Sign in as an admin, open `/admin/orders?view=all` → the purged order's Email and Ship to cells read "Personal data removed" in muted text → AC-8
- [ ] Tab to the purged order's link and press Enter → its page shows "Personal data removed on <date>" in the Email and Delivery address rows, the date in `STORE_TIMEZONE` and `STORE_LOCALE` → AC-8 (Value sourcing: `pii_purged_at` through `formatDate`)
- [ ] Run axe on both pages → no violations → AC-8
- [ ] A paid order's pages still show its email and address as before → AC-9

## Readers (AC-9)
- [ ] `/checkout` for a cart whose newest order was purged → prefills from the newest order left, or opens empty → AC-9 (Value sourcing: prefill never reaches a purged order, its `cart_id` is null)
- [ ] `/checkout/complete?session_id=<purged order's session>` → "not completed" state → AC-9

## Commands
- [ ] `pnpm test:db tests/db/purge-expired-orders.db.test.ts` → all pass → AC-1 to AC-7
- [ ] `pnpm test src/features/orders/email-display.test.ts` → "Email missing" branch covered → AC-9
- [ ] `pnpm test:e2e tests/e2e/admin/purged-order.spec.ts` → passes on desktop and mobile → AC-4, AC-8

## Acceptance-criteria coverage
- AC-1 cron steps 2, 3, 5 · AC-2 cron steps 2, 4, 6 · AC-3 data steps 1 to 4 · AC-4 cron steps 1, 2, 10 · AC-5 cron steps 7, 8 · AC-6 command step 1 (failure test) · AC-7 cron step 9 · AC-8 UI steps 1 to 3 · AC-9 UI step 4, readers steps 1, 2, command step 2 · AC-10 cron step 11
