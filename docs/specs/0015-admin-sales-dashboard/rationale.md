# 0015. Admin sales dashboard: rationale

## Context

The admin panel lands on a placeholder `Welcome` page. Admins have no way to see how the store is doing without opening the Stripe dashboard, and Stripe cannot tell them which products sell or how a period compares with the one before. Scope feature 15 asks for revenue, order count, average order value and best sellers over a chosen period, with three hard conditions: the numbers match the orders in the database, refunds are subtracted, and the page loads fast with a year of orders.

The money already lives in the database in a shape that can be summed exactly: orders carry integer `total_cents`, `paid_at` and `currency`; refunds carry `amount_cents`, `status` and `succeeded_at`; order lines and refund lines carry quantities. `orders.refunded_cents` is a running total, not dated, so it cannot say when money went back. Refunds are free amounts an admin types (spec 0010), with refund lines recording only units, so money cannot be split back onto products exactly. A late payment on an expired or cancelled order is money in with no `paid_at` (spec 0010, `flagLatePayment`), and its refund is money out.

Day boundaries matter. The store shows dates in `STORE_TIMEZONE` and stores UTC; an order at 23:30 store time must land on that store day, also across daylight saving changes. The orders list already turns store days into UTC instants with `zonedDayStart`, but filters by `created_at`, while a sale happens at `paid_at`.

The store is a single brand shop with a few admins. A busy year is thousands to low tens of thousands of orders. Cache Components is on, and every cached read in this app must be expired by whatever changes it; the money paths (webhook, reconcile cron, refund action, refund sync, system refunds) are already numerous and carefully guarded.

## Options considered

### Option 1: Live SQL aggregates per request on existing indexes

Each page load runs a few parameterised aggregate queries (`$queryRaw`) over `[previous start, current end)`, using `FILTER` clauses for the two windows and `date_trunc` in the store's time zone for chart buckets, on the existing `orders.paid_at` and `refunds.succeeded_at` indexes. Nothing is cached or stored.

**Pros**:
- Always exact and fresh; "numbers match the database" holds by construction.
- No new table, migration, cron or cache tag; no money path has to change.
- Time zone bucketing happens in one place (Postgres), with bound parameters.

**Cons**:
- Every load scans the window's rows; cost grows with order volume.
- Raw SQL is less type safe than Prisma's query builder and needs its own result parsing (bigint sums).

### Option 2: `'use cache'` reads with a sales tag

The same queries wrapped in cached functions, tagged with a new sales tag that every paid order and every refund state change expires.

**Pros**:
- Repeat loads are near instant.
- Fits the app's existing Cache Components pattern for catalog reads.

**Cons**:
- Five separate money paths must remember to expire the tag; a miss shows stale money, the one thing this page must never do.
- "Today" and rolling windows depend on the current time, so cache keys need the store day, adding subtle staleness at midnight.
- Solves a speed problem that has not been measured.

### Option 3: Daily rollup table

A table of per day totals (and per day per product units), kept by a trigger or by the reconcile cron, read by the dashboard.

**Pros**:
- Reads stay fast at any scale.
- Chart buckets become simple sums over at most 366 rows.

**Cons**:
- A new table, migration, RLS setup and a second source of truth that must be kept exactly in step with orders and refunds, or the numbers stop matching.
- Today's figures need either a live query anyway or a trigger on every money write.
- Far more machinery than a store of this size needs.

### Chart: shadcn Chart (Recharts) against hand built SVG

The shadcn Chart component wraps Recharts and themes it from the design tokens, with tooltip support; it adds one dependency to the admin bundle. Hand built SVG bars add no dependency and render on the server, but mean writing axes, labels, tooltips, negative values and dark mode by hand. The engineer chose shadcn Chart; accessibility is kept in our hands with a hidden SVG plus a "Show as table" toggle rather than relying on Recharts' own accessibility layer.

## Rationale

Option 1 wins because the scope's first condition is exactness, and only a live read is exact by construction. Options 2 and 3 both create a second copy of money figures that every payment and refund path has to keep in step; this app already has five such paths with careful locking, and adding a cache expiry or a rollup write to each of them is exactly the kind of quiet coupling that produces a wrong dashboard months later. The third condition, speed with a year of orders, is real but not yet a problem: Postgres sums tens of thousands of indexed integer rows in milliseconds. So instead of guessing, the spec makes speed a test (AC-15, exact sums on a seeded year within a CI time budget) and leaves an index as the measured next step if it fails. Option 2 is the runner up, and the right move only if that test or production logs (`dashboard.slow`) show a problem.

The money definitions follow from what the data can say honestly. Refunds come off the day they succeeded (cash basis) because a refund row has its own date while `refunded_cents` does not, and because a past period that keeps changing breaks comparison. Orders count by `paid_at` whatever their status now, so a cancelled paid order contributes its payment and its refund like any other, and money stays true over all time. Refunds of orders with no `paid_at` are left out so a late payment and its refund cancel off the books instead of pushing net below the real money. Average order value uses gross, not net, so a refund of an old order cannot move this period's AOV. Best sellers rank by net units, the one per product figure refunds can be subtracted from exactly, since refund money is not split per line.

The orders list gains a paid date filter rather than the dashboard linking with created dates, because the scope promises the numbers match the orders, and the link is how an admin checks that. Filtering to `STORE_CURRENCY` with a visible notice, instead of summing every row, means a future currency change cannot silently add unlike money.
