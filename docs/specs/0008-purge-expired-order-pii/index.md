# 0008. Purge personal data from expired orders

**Date**: 2026-10-01
**Status**: Accepted

## Summary

Orders that expire without payment still hold the customer's email, name, phone and delivery address, and nothing ever removes them. A new daily cron blanks those fields (and the links to the cart and the customer) once an order has been `expired` for more than 30 days, and stamps the order with `pii_purged_at`. Paid orders are never touched: the database itself refuses to purge anything that is not `expired`. Admin pages show "Personal data removed" where the email and address used to be, and everything else about the order (number, lines, totals, Stripe ids) stays.

## Requirements

**User stories**:
- As a customer who abandoned a checkout, I want the store to forget my contact and address details after a short while, so my data is not kept longer than it is useful.
- As the store owner, I want unpaid orders to stop holding personal data after a fixed period, so the privacy policy (feature 16) can promise a concrete retention time and the store keeps it automatically.
- As an admin, I want a purged order to say plainly that its personal data was removed, so I never mistake it for a broken or incomplete order.

**Acceptance criteria**:
- **AC-1**: An order is due for purge when `status = 'expired'`, `pii_purged_at IS NULL` and `expired_at < now() - 30 days` (database clock, UTC). Purging sets `email`, `customer_name`, `phone`, `ship_full_name`, `ship_line1`, `ship_line2`, `ship_city`, `ship_postal_code`, `ship_country_code`, `cart_id` and `customer_id` to null, and sets `pii_purged_at = now()` and `updated_at = now()`. Number, status, lines, totals, currency, Stripe ids, `needs_attention`, `expired_at` and `order_events` stay exactly as they were.
- **AC-2**: The purge never touches an order that is not due: an `expired` order whose `expired_at` is 30 days ago or less, an order already purged, and every order in `pending_payment`, `paid`, `shipped`, `delivered` or `cancelled`. An `expired` order with `needs_attention = true` is purged like any other.
- **AC-3**: The database enforces the rules: `CHECK (email IS NOT NULL OR pii_purged_at IS NOT NULL)` (every order not purged has an email), `CHECK (pii_purged_at IS NULL OR status = 'expired')` (only an expired order can be purged) and `CHECK (status <> 'expired' OR expired_at IS NOT NULL)` (every expired order has an expiry time). The migration first backfills `expired_at = updated_at` for any `expired` row missing it, so the checks apply to existing data. An `UPDATE` that sets `pii_purged_at` on a paid order fails with a check violation.
- **AC-4**: `GET /api/cron/purge-expired-orders` with `Authorization: Bearer ${CRON_SECRET}` (constant time check through `isCronRequest`) purges due orders in batches of 1000 until a batch purges nothing or the run has used 50 seconds (`PURGE_TIME_BUDGET_MS`), and answers `200 { purged }` with the total. A run that stops on the time budget leaves the rest for the next day. The route sets `export const maxDuration = 60`. A missing or wrong header answers 401 and changes nothing. `vercel.json` schedules it daily at `0 4 * * *` (after the 03:30 reconcile run).
- **AC-5**: The purge is safe to repeat and to overlap. A second run right after the first answers `{ purged: 0 }`. Two runs at the same moment both succeed, and each due order is purged exactly once (a row locked by one run is skipped by the other, and the outer `WHERE` checks again that the row is still due).
- **AC-6**: If a batch fails (database error), the batches already committed stay purged, the handler logs `cron.purge_expired_orders_failed` (error level, with `purged` so far, the error's `name` and its Postgres SQLSTATE from `pgErrorCode`, never its message, since a Postgres error detail can quote the failing row) and answers `500 { error: "purge_failed", purged }`. The next daily run picks up the rest; nothing needs a manual fix.
- **AC-7**: A successful run logs `cron.purge_expired_orders` with the `purged` count only. No log line from this feature carries an email, name, phone, address, cart id or customer id.
- **AC-8**: On `/admin/orders?view=all`, a purged order's Email cell and Ship to cell each read "Personal data removed" (muted text), checked on `piiPurgedAt` before the existing "Not recorded" branch. On `/admin/orders/[number]`, the Email row and the Delivery address row (which also holds the phone) read "Personal data removed on <date>", checked before the existing "No address recorded" branch; the date is `pii_purged_at` through `formatDate` with the component's existing `dateFormat` (`STORE_TIMEZONE`, `STORE_LOCALE`). Both pages still call `requireAdmin()`, work by keyboard, and pass axe with no violations.
- **AC-9**: With `orders.email` nullable, every existing reader still type checks and behaves as before. The checkout prefill never returns a purged order (its `cart_id` is null). `/checkout/complete` answers `not_completed` for an expired order before it reads the email. A null email on an order that is not purged is a broken invariant, handled per place: the admin detail query and `getCompletion` (paid path) throw; the admin list shows "Email missing" for that row and logs `order.email_missing` (order id only); the checkout prefill returns null and logs the same event. A null email is never shown as an empty string.
- **AC-10**: The 30 days live in one named constant, `EXPIRED_ORDER_PII_RETENTION_DAYS = 30` in `src/features/orders/purge-expired.ts`, with a comment saying that the privacy policy states this number and that both change together. No env variable or setting overrides it.

## Decision

**Chosen option**: Option 1: a daily cron that blanks the personal data columns in place on expired orders

Keep the expired order row and blank only the columns that identify a person, guarded by database checks so a paid order can never be purged, run by a dedicated Vercel cron route like the existing expired carts job.

**Implementation skills**: `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `prisma-cli` (`prisma/skills`, `.agents/skills/prisma-cli/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `playwright-best-practices` (`.agents/skills/playwright-best-practices/`) · `accessibility` (`.agents/skills/accessibility/`)

**Calls made in this spec** (pick, why, runner up):
- **One raw SQL `UPDATE` per batch, joined to a `MATERIALIZED` CTE that picks the batch with `FOR UPDATE SKIP LOCKED`, and the due condition repeated in the outer `WHERE`**. Not `id IN (subquery)`: Postgres plans that as a nested loop that rescans the locking subquery per row, skips rows the statement already updated, and so ignores the `LIMIT`. Overlapping runs never block each other or purge twice, and each batch is a short statement with short locks. Runner up: Prisma `updateMany` with a `take`, which cannot lock and skip rows.
- **The cutoff is computed in Postgres (`now() - make_interval(days => 30)`)**, not from the server clock. One clock for `expired_at` (set by `markExpired` with `now()`) and the cutoff. Runner up: a `Date` computed in Node, which drifts from the database clock.
- **No test only parameters.** The batch size is the constant `PURGE_BATCH = 1000`; the database test proves the loop by seeding more due orders than one batch. The failure path and the time budget are tested by mocking or spying on the db client and spying on `performance.now`, not through test only options. Runner up: injectable `runBatch` and `budgetMs` seams, which widen the production signature for tests alone.
- **`purgeExpiredOrders` returns `{ ok: true, purged } | { ok: false, purged, error }` instead of throwing**, so the request wrapper can report the count already committed in the 500 and the log. Runner up: a custom error class carrying the count, which hides a normal outcome inside an exception.
- **A 50 second time budget per run, with `maxDuration = 60`.** The first run after deploy may meet a large backlog; a platform timeout would kill the function without the log or the 500. Stopping early returns a clean `200 { purged }`, and the next day continues. Runner up: a cap on batch count, which does not track how slow each batch is.
- **Null email handling depends on the page.** Pages where a throw would block everyone (the admin list, the checkout form) degrade and log. Pages about one order (the admin detail, the paid confirmation) throw. Runner up: throw everywhere, where one bad row would take down the whole admin list.
- **A partial index `orders_purge_due_idx` on `(expired_at) WHERE status = 'expired' AND pii_purged_at IS NULL`**, declared in Prisma with `where: raw(...)` like the existing partial unique. It stays as small as the backlog, and each run reads only due rows. Runner up: rely on `(status, created_at)`, which scans every expired order ever made.
- **Backfill `expired_at` from `updated_at` in the migration and enforce it with a CHECK**, instead of `COALESCE(expired_at, updated_at)` in the query. The query and the index stay simple, and no future path can expire an order without a time. Runner up: the `COALESCE`, which cannot use the partial index.
- **Purge does not live in `src/lib/orders/transitions.ts`**: it never changes `status`, and that file's contract is status changes only. It lives in `src/features/orders/purge-expired.ts` beside `reconcile.ts`. Runner up: `src/lib/orders/`, which is for code two features share.
- **`pii_purged_at` is selected by the admin queries and drives the "Personal data removed" text**, not a null email check. A null email on an order that is not purged is a bug and must be loud. Runner up: show the message whenever the email is null, which would hide that bug.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

| Path | What |
|---|---|
| `prisma/schema.prisma` | `Order.email String?`, `Order.piiPurgedAt DateTime? @map("pii_purged_at") @db.Timestamptz(3)`, `@@index([expiredAt], map: "orders_purge_due_idx", where: raw("status = 'expired'::order_status AND pii_purged_at IS NULL"))` (the enum cast written as Postgres normalizes it, so `migrate dev` sees no drift) |
| `prisma/migrations/<ts>_purge_expired_order_pii/migration.sql` | in this order: `ALTER COLUMN email DROP NOT NULL`, `ADD COLUMN pii_purged_at`, the partial index (generated), then in a hand written section (CHECKs are invisible to drift detection, as in the data model migration): the `expired_at` backfill `UPDATE`, then the three CHECK constraints (AC-3) |
| `src/features/orders/purge-expired.ts` | `EXPIRED_ORDER_PII_RETENTION_DAYS`, `PURGE_BATCH`, `PURGE_TIME_BUDGET_MS = 50_000`, `purgeBatch(): Promise<number>` (one statement, module private), `purgeExpiredOrders(): Promise<{ ok: true; purged: number } \| { ok: false; purged: number; error: unknown }>` (never throws; carries the count out on failure), `purgeExpiredOrdersRequest(request)` (no options) |
| `src/lib/db-errors.ts` | export `pgErrorCode(error): string \| null` (the SQLSTATE at `meta.driverAdapterError.cause.originalCode`, built on the existing `pgCause`) |
| `src/features/orders/log.ts` | `cron.purge_expired_orders` (info, `purged`), `cron.purge_expired_orders_failed` (error, `purged`, `errorName`, `pgCode`) |
| `src/lib/orders/log.ts` | `logEmailMissing`, `order.email_missing` (error, `orderId`): one definition, imported by both the orders and checkout features |
| `app/api/cron/purge-expired-orders/route.ts` | thin `GET`: `await connection()`, then `purgeExpiredOrdersRequest(request)`; `export const maxDuration = 60` |
| `vercel.json` | add `{ "path": "/api/cron/purge-expired-orders", "schedule": "0 4 * * *" }` |
| `src/features/orders/admin-queries.ts` | select `piiPurgedAt` in the list and detail queries; `AdminOrderDetail` gains `piiPurgedAt: Date \| null` (the list row spreads the order); `email: string \| null` on both; the detail query throws on a null email when `piiPurgedAt` is null |
| `src/features/orders/components/admin-orders-list.tsx`, `admin-order-detail.tsx` | the "Personal data removed" cells and rows, checked on `piiPurgedAt` first; "Email missing" on the list for the broken case (AC-8, AC-9) |
| `src/features/orders/components/` (shared component) | the email and "Personal data removed" rendering used by both the list and the detail, with a render unit test |
| `src/features/checkout/queries.ts` | `checkoutPrefill`: a null email returns null and logs `order.email_missing`; `getCompletion`: throw on a null email before `maskEmail` on the paid path (AC-9) |
| `tests/db/fixtures.ts` | `createOrder` sets `expiredAt` when `status` is `expired`, and accepts `expiredAt` and `piiPurgedAt` overrides |

### Data model sketch

One migration on `orders`, no new table (so no new RLS step).

| Column or constraint | Before | After |
|---|---|---|
| `email` | `text NOT NULL` | `text NULL` |
| `pii_purged_at` | (none) | `timestamptz(3) NULL`, set once by the purge, never cleared |
| `orders_email_present_check` | (none) | `CHECK (email IS NOT NULL OR pii_purged_at IS NOT NULL)` |
| `orders_purge_only_expired_check` | (none) | `CHECK (pii_purged_at IS NULL OR status = 'expired')` |
| `orders_expired_at_present_check` | (none) | `CHECK (status <> 'expired' OR expired_at IS NOT NULL)`, after `UPDATE orders SET expired_at = updated_at WHERE status = 'expired' AND expired_at IS NULL` |
| `orders_purge_due_idx` | (none) | `INDEX (expired_at) WHERE status = 'expired' AND pii_purged_at IS NULL` |

Columns set to null by a purge: `email`, `customer_name`, `phone`, `ship_full_name`, `ship_line1`, `ship_line2`, `ship_city`, `ship_postal_code`, `ship_country_code`, `cart_id`, `customer_id`. The existing `orders_email_idx` stays (Postgres indexes nulls; purged rows simply hold null).

The purge statement, for reference. The `::int` casts matter: through `@prisma/adapter-pg` a JS number is not guaranteed to bind as an integer, and `make_interval` accepts only one. The batch is a `MATERIALIZED` CTE because `id IN (subquery)` is planned as a nested loop that rescans the locking subquery per row and ignores the `LIMIT`.

```sql
WITH due AS MATERIALIZED (
  SELECT id FROM orders
  WHERE status = 'expired' AND pii_purged_at IS NULL
    AND expired_at < now() - make_interval(days => ${EXPIRED_ORDER_PII_RETENTION_DAYS}::int)
  ORDER BY expired_at
  LIMIT ${batch}::int
  FOR UPDATE SKIP LOCKED
)
UPDATE orders
SET email = NULL, customer_name = NULL, phone = NULL,
    ship_full_name = NULL, ship_line1 = NULL, ship_line2 = NULL, ship_city = NULL,
    ship_postal_code = NULL, ship_country_code = NULL,
    cart_id = NULL, customer_id = NULL,
    pii_purged_at = now(), updated_at = now()
FROM due
WHERE orders.id = due.id
  AND orders.status = 'expired' AND orders.pii_purged_at IS NULL
  AND orders.expired_at < now() - make_interval(days => ${EXPIRED_ORDER_PII_RETENTION_DAYS}::int)
```

### State transitions

No status changes. `pii_purged_at` is a one way flag inside the terminal `expired` state:

```
expired (pii_purged_at null) ──cron, expired_at older than 30 days──▶ expired (pii_purged_at set)
```

This is the one order write not guarded by `status = 'pending_payment'`; it is guarded by `status = 'expired'` instead, and the CHECK makes any other status impossible.

### API surface

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/cron/purge-expired-orders` | route handler, GET | `Authorization` header | `200 { purged: number }` | `Bearer ${CRON_SECRET}` via `isCronRequest` | 401 `{ error: "unauthorized" }`; 500 `{ error: "purge_failed", purged }` after a failed batch |
| `purgeExpiredOrders()` | server function | none | `{ ok: true, purged } \| { ok: false, purged, error }` | server only | never throws; `error` (on `ok: false`) is the caught database error, the request wrapper logs it and answers 500 |
| `/admin/orders`, `/admin/orders/[number]` | pages | as spec 0006 | adds the "Personal data removed" text | `requireAdmin()` + proxy gate | as spec 0006 |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| purge | which orders are due | `orders.status`, `orders.pii_purged_at`, `orders.expired_at` compared with Postgres `now()` |
| purge | the 30 days | `EXPIRED_ORDER_PII_RETENTION_DAYS` (decided here, AC-10) |
| purge | `pii_purged_at` | Postgres `now()` in the same statement |
| purge | batch size | `batch` parameter, default `PURGE_BATCH = 1000` |
| purge | when to stop early | `PURGE_TIME_BUDGET_MS = 50_000` against `performance.now()` at loop start |
| cron response and log | `purged` | sum of rows each batch statement reports |
| failure response and log | `purged` so far, error name and code | the `purged` field of the result; the error's `name` and `pgErrorCode(error)` from `src/lib/db-errors.ts` (never `message` or `meta`, which can quote row data) |
| admin list | "Personal data removed" in Email and Ship to | `orders.pii_purged_at IS NOT NULL` |
| admin detail | "Personal data removed on <date>" | `orders.pii_purged_at`, `formatDate` from `src/lib/dates.ts` with the component's existing `dateFormat` |
| admin list, prefill | "Email missing" / no prefill, and `order.email_missing` | `email IS NULL AND pii_purged_at IS NULL` (a broken invariant) |
| checkout prefill | never a purged order | `cart_id` is null after a purge, and the query filters by `cart_id` |

### Key invariants

- Only an `expired` order can carry `pii_purged_at` (DB CHECK). A paid order cannot be purged by any code path.
- Every order that is not purged has an email (DB CHECK). Code that finds `email === null` with `pii_purged_at` null has hit a bug: it throws or degrades and logs as AC-9 says per page.
- Every `expired` order has `expired_at` (DB CHECK).
- `pii_purged_at` is written once and never cleared; nothing restores purged data.
- The retention period has one source, the constant.

### Security model

- Compliance scope: GDPR (EU store, storage limitation and data minimisation). Expired orders exist because a checkout started; no money moved, so there is no accounting reason to keep personal data. This feature is the mechanism behind the retention promise in feature 16's privacy policy.
- Only the cron with the right `CRON_SECRET` can trigger a purge (constant time compare, 401 otherwise, refused before any database work). There is no admin button and no public path.
- The admin pages that show the result keep `requireAdmin()`; no role sees purged data because none is left.
- Audit trail: `pii_purged_at` per order plus the daily count log. No per order event row (engineer's choice), and no log ever carries personal data.
- Out of scope, kept on purpose: the copy Stripe holds on the Checkout Session and Payment Intent (Stripe acts as processor), and database backups (they age out on the Supabase backup schedule). Both belong in the privacy policy (Follow-up).

### Configuration required

None new. `CRON_SECRET` already exists (spec 0005).

### Critical test scenarios

- Happy path: seed expired orders 31 days and 29 days old plus a paid and a cancelled order; call the route with the secret; only the 31 day order has every listed column null and `pii_purged_at` set, its lines and totals unchanged, response `{ purged: 1 }`, verifies **AC-1**, **AC-2**, **AC-4**
- Flagged order: an expired order with `needs_attention = true` and 31 days old is purged and keeps the flag, verifies **AC-2**
- Database guard: a raw `UPDATE` setting `pii_purged_at` on a paid order fails with a check violation; a raw `UPDATE` setting `email = NULL` on a pending order fails, verifies **AC-3**
- Loop and repeat: `PURGE_BATCH + 1` due orders all get purged in one call (three statements); a second call returns 0, verifies **AC-4**, **AC-5**
- Overlap: two `purgeExpiredOrders()` calls in parallel on the same due rows return totals that sum to the number of due rows, no error (one may return 0 early while the other finishes the rows it locked), verifies **AC-5**
- Failure: with `@/lib/db` mocked so the first batch reports 2 rows and the second throws a Postgres error, the call returns `{ ok: false, purged: 2, error }`; through the request wrapper it logs `cron.purge_expired_orders_failed` with `pgCode` and answers `500 { error: "purge_failed", purged: 2 }`, verifies **AC-6**
- Time budget: with `performance.now` spied past `PURGE_TIME_BUDGET_MS` after the first batch, the loop stops and returns `{ ok: true, purged }` with the partial count, verifies **AC-4**
- Auth/permission: no header and a wrong bearer each answer 401 and purge nothing, verifies **AC-4**
- Logs: the captured pino lines for a run hold only the event name and counts, verifies **AC-7**
- Admin UI (Playwright): a seeded purged order shows "Personal data removed" in the list (with `?view=all`) and "Personal data removed on <date>" on its page; axe passes, verifies **AC-8**
- Readers: the prefill test with a purged order in the cart's history returns the newest non purged order or null; `getCompletion` for a purged order's session id returns `not_completed`. The "Email missing" branch cannot be reached through the database (the CHECK forbids it), so it gets a unit test on the list row rendering, verifies **AC-9**

## Build plan

Tracer Bullet: the first task stands up the whole thread (schema, purge, route, schedule, log) so a real cron call purges a real row; the next tasks thicken the admin view and the safety net.

1. [x] Migration and schema: `email` nullable, `pii_purged_at`, `expired_at` backfill, the three CHECKs, `orders_purge_due_idx`; `createOrder` in `tests/db/fixtures.ts` sets `expiredAt` for expired orders; fix every type error the nullable email causes in `src/` and `tests/` with the per page rule of AC-9 and the `order.email_missing` log, satisfies **AC-3**, **AC-9**
2. [x] `pgErrorCode` in `src/lib/db-errors.ts`; `src/features/orders/purge-expired.ts` (constants, `purgeBatch`, the loop with time budget returning `{ purged, error }`, request wrapper with the 401, 200 and 500 paths), the logs in `src/features/orders/log.ts`, `app/api/cron/purge-expired-orders/route.ts` with `maxDuration`, the `vercel.json` entry, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-10**
3. [x] Admin list and detail: select `piiPurgedAt`, check it before the "Not recorded" and "No address recorded" branches, render "Personal data removed" in Email and Ship to, and "Personal data removed on <date>" in the detail Email and Delivery address rows, satisfies **AC-8**, **AC-9**
4. [x] Safety net: `tests/db/purge-expired-orders.db.test.ts` (due rule, untouched statuses, flagged, CHECK violations, batch loop, rerun, overlap, failure, 401, logs), prefill and completion cases added to the existing checkout db tests, a Playwright admin spec with axe for a purged order, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-9**

## Consequences

**Positive**:
- Abandoned checkouts stop holding personal data after a known, short period, and the privacy policy can state it as a fact the system enforces.
- The database, not only the code, guarantees a paid order can never lose its customer data to this job.
- The order row survives, so order numbers, abandoned checkout counts (useful for feature 15's dashboard) and the Stripe trail for a flagged order stay available.

**Negative / tradeoffs**:
- `orders.email` becomes nullable. Every future reader (order emails in feature 11, accounts in feature 12, admin search) must handle `null`, even though only purged expired orders can hold it. This weakens spec 0002's "an email on every order" to "an email on every order not purged".
- A support request about a failed payment older than 30 days can no longer be matched by email; the admin needs the order number or the Stripe dashboard.
- A flagged expired order (money may have moved) loses its email after 30 days; the admin must resolve it from the Stripe ids before then, and there is no tool to clear a flag until feature 10.
- Stripe still holds the name, email and address on the Checkout Session, and backups hold old rows until they age out. The purge covers BeStore's own database only.
- Purge is permanent; a wrong retention constant cannot be undone for rows already purged.

**Neutral**:
- A third daily cron in `vercel.json`. Vercel's Hobby plan allows only daily crons, which this fits.
- `src/features/orders/AGENTS.md` says every order write is guarded by `status = 'pending_payment'`; the purge is the documented exception (guarded by `status = 'expired'`). `/sync` should record it.

## Follow-up

- [ ] Feature 16: the privacy policy states the 30 day retention for unpaid orders, that Stripe keeps its own copy as processor, and how long database backups keep data.
- [ ] Spec 0002 records `orders.email` as always present; after this ships it is "present unless purged". `/sync` should flag that line and the orders `AGENTS.md` guard convention.
- [ ] Check whether Stripe's data redaction tooling can remove the customer details from expired Checkout Sessions, and decide in a separate spec if it is worth it.
- [ ] Feature 10 (admin order management) should let an admin clear `needs_attention`, so a flagged expired order can be resolved inside the 30 days.
- [ ] Feature 12 (accounts): account deletion should purge or unlink orders the same way; reuse the column list from `purge-expired.ts` rather than copying it.
