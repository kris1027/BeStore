# 0015. Admin sales dashboard

**Date**: 2026-10-18
**Status**: Accepted

## Summary

The admin landing page (`/admin`) becomes a sales dashboard. It shows net revenue (what customers paid minus refunds), order count, average order value, net units sold, a net revenue chart and the top 10 products, for a period the admin picks (presets or a custom range, in store days). A refund comes off the period it succeeded in, not the period of its order, so past periods never change. Every number is a live SQL sum over columns and indexes that already exist, with no cache and no new table, and a database test proves the sums are exact and fast with a year of orders.

## Requirements

**User stories**:
- As an admin, I want to see what the store earned in a period, after refunds, so that I know how the business is doing without opening Stripe.
- As an admin, I want to compare a period with the one before it, so that I can tell whether sales are going up or down.
- As an admin, I want to see which products sell best, so that I know what to restock and promote.
- As an admin, I want to jump from the order count to the matching orders, so that I can check the numbers myself.

**Acceptance criteria**:

*The page and the period*
- **AC-1**: `/admin` (the panel landing page) shows the dashboard: an `h1` "Dashboard", the line "Signed in as <admin name>", the period picker, four stat cards (Net revenue, Orders, Average order value, Net units sold), the net revenue chart and the best sellers table, in that order. The `Welcome` component is deleted. "Dashboard" is the first sidebar item (`href: "/admin"`), marked `aria-current="page"` only on `/admin` itself, not on its sub pages. The page calls `requireAdmin()` itself; anyone not signed in as an admin gets the existing admin gate answer (spec 0004).
- **AC-2**: The presets are Today, Last 7 days, Last 30 days, This month and Last 12 months, in the URL as `?period=today|7d|30d|month|12m`. With no valid period in the URL, Last 30 days is used. Days are calendar days in `STORE_TIMEZONE`; a period runs from the start of its first day to the start of the day after its last day. Today is today. Last 7 days is today and the 6 days before. Last 30 days is today and the 29 days before. This month runs from the 1st of the current month to today. Last 12 months runs from the 1st of the month 11 months before the current one to today (the current month is month to date).
- **AC-3**: A custom range is `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both store days, inclusive. When both are valid they win over `period`. A `to` after today is clamped to today. A missing side, a day that does not exist (`parseCalendarDay`), `from` after `to`, `from` after today, or a range longer than 366 days falls back to Last 30 days and shows the notice "That date range can't be used. Showing the last 30 days." The picker is a plain GET form (a preset select, two labelled date inputs and an Apply button) that works without JavaScript.
- **AC-4**: The previous window has the same number of store days as the chosen one and ends on the day before the chosen one starts. This holds for every preset: on Oct 18, This month (18 days) compares with Sep 13 to Sep 30, and Last 12 months compares with the same number of days just before its start, never with "last month to date". Each card shows its change against the previous window's value of the same figure: when the previous value is above 0 and the current figure exists, "Up N%", "Down N%" or "No change", followed by "vs previous <n> days" (N rounded to a whole percent, half away from zero; "No change" when N rounds to 0); otherwise "No earlier figure to compare" with no suffix. The meaning is carried by the words, never by colour alone.

*The numbers*
- **AC-5**: A counted order is any order whose `paid_at` is inside the window and whose `currency` equals `STORE_CURRENCY`, whatever its status now (`paid`, `shipped`, `delivered`, or `cancelled` after payment). Orders is the count of counted orders. Gross is the sum of their `total_cents` (after discounts, delivery included).
- **AC-6**: A counted refund is a refund with `status = succeeded` whose `succeeded_at` is inside the window and whose order has a `paid_at` (in any period) and `currency = STORE_CURRENCY`. Refunds of orders that were never marked paid (late payments, spec 0010) never count; `pending` and `failed` refunds never count. Refunds is the sum of `amount_cents` of counted refunds. Net revenue is Gross minus Refunds; it can be negative and is then shown with a minus sign. The Net revenue card shows the net as its main figure and the lines "Gross <amount>" and "Refunds <amount>" under it.
- **AC-7**: Average order value is Gross divided by Orders, rounded to a whole cent (half up). With 0 orders the card shows "No orders" instead of an amount, and its change line is fixed by this rule: "No orders in this period" when the previous window had orders, otherwise "No earlier figure to compare". Neither text gets the "vs previous <n> days" suffix, which only follows a percent (AC-4).
- **AC-8**: Net units sold is the sum of `order_lines.quantity` on counted orders minus the sum of `refund_lines.quantity` on counted refunds.
- **AC-9**: Best sellers group lines by `product_id`, or by the line's `product_name` snapshot when `product_id` is null (product deleted). Per group: units sold (lines of counted orders), units refunded (refund lines of counted refunds), net units (the difference) and sales (the sum of `line_total_cents` of counted orders' lines). A group exists when it has sold lines or refunded lines in the window (or both), so a product only refunded in the window is a group with negative net units. Only groups with net units above 0 are listed: the top 10, sorted by net units descending, then sales descending, then name ascending. Columns: Product (the current `products.name`, linking to `/admin/products/<id>`, when the product still exists, otherwise the `product_name` of its most recent line, with no link), Net units, Sales. Whenever at least one group has net units of 0 or less (sold and fully refunded, or only refunded), the line "Units refunded for products not listed here also come off Net units sold." shows under the table. With no listed group: "No products sold in this period."
- **AC-10**: When orders with `paid_at` inside the window, or succeeded refunds with `succeeded_at` inside the window, belong to orders in a currency other than `STORE_CURRENCY`, the page shows "N orders in another currency are left out of these figures." (singular: "1 order in another currency is left out of these figures."), where N counts distinct such orders from both. Their refunds are left out of every figure too. All money is formatted with `formatMoney` in `STORE_CURRENCY` and `STORE_LOCALE`.

*The chart*
- **AC-11**: The chart shows net revenue per bucket. A window of up to 31 days has a bucket per day, up to 182 days a bucket per week (weeks start on Monday), and longer a bucket per calendar month. The first and last week or month are clipped to the window. Buckets are in `STORE_TIMEZONE`. A bucket is keyed by its real first day (the Monday, or the 1st of the month, even when that is before the window start) but labelled from its first day inside the window: "Oct 18" for a day, "Week of Oct 15" for a week clipped to start on Oct 15, "Oct 2026" for a month (a clipped month keeps the month label). A bucket's net is the gross of counted orders paid in it minus counted refunds succeeded in it, using the same half open bounds as the window, so the buckets add up to the window's figures exactly. Every bucket of the window is shown, an empty one as 0, and a negative bucket goes below the zero line. The chart has a fixed height (so it renders without a measured parent). Bars use the `--chart-*` tokens from `design.md`, and axis tick text uses a token pair that passes AA contrast; a tooltip shows the bucket label and its net.
- **AC-12**: The chart has the visible heading "Net revenue per day" (or week or month) and the SVG is hidden from screen readers. A "Show as table" button (`aria-expanded`, keyboard reachable, visible focus) shows the same buckets in a `Table` with a caption and the columns Period, Gross, Refunds and Net; pressing it again ("Hide table") hides it.

*Links into orders*
- **AC-13**: The Orders card links "View these orders" to `/admin/orders?status=all&dates=paid&from=<first day>&to=<last day>` for the chosen window. `/admin/orders` accepts `dates=created|paid` (default `created`; any other value is ignored like the list's other bad params). With `paid`, `from` and `to` filter `paid_at` by store days instead of `created_at`, and orders without a `paid_at` are left out; `dates=paid` with neither `from` nor `to` only leaves out unpaid orders. `dates` is carried by the list's href builder (`adminOrdersHref`, so paging keeps it) and counted by its "filters are set" check. The orders filter form gains a "Date" select with "Order placed" and "Paid" so the state is visible and can be changed. When every order in the window is in `STORE_CURRENCY`, the rows of the list, counted across all its pages, equal the dashboard's order count.

*States, speed and access*
- **AC-14**: While the figures load, the cards, chart and table show skeletons inside `Suspense`. A period with no orders and no refunds shows 0 figures, "No orders", a flat chart and the empty best sellers text. A failed read logs `dashboard.query_failed` with the SQLSTATE (`pgErrorCode`, never the Postgres message) and rethrows, so the existing `app/error.tsx` boundary shows the error page (no new error file).
- **AC-15**: Every figure comes from live queries on each request: no `'use cache'`, no stored totals, no new table or column. The reads run in one `REPEATABLE READ` read only transaction, so every figure on the page comes from the same snapshot. In `pnpm test:db`, with a seeded year of about 20,000 counted orders (with lines) and about 2,000 succeeded refunds (some with lines), every figure for a Last 12 months window (current and previous windows, cards, chart and best sellers) equals the sum the test computes on its own from the seeded rows (strict). After one warm up run, the median of 3 runs of all dashboard reads is within 1,500 ms (the CI budget); 500 ms is the local target, logged by the test but not asserted.
- **AC-16**: The page meets WCAG AA: the picker's controls have labels, everything works by keyboard with visible focus, axe finds no violations with data and with an empty period (chart tick text included, with no axe rule disabled), and on a phone width the cards stack with no horizontal page scroll.

## Decision

**Chosen option**: Option 1: Live SQL aggregates per request on existing indexes

The dashboard reads its figures with a few parameterised raw SQL aggregate queries (Prisma `$queryRaw`) on every request, bucketed in `STORE_TIMEZONE` inside Postgres, with no cache layer and no schema change; the chart uses the shadcn Chart component (Recharts).

**Implementation skills**: `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

No new table, column or index. The dashboard reads:

| Table | Columns read | Index used |
|---|---|---|
| `orders` | `id`, `paid_at`, `currency`, `total_cents` | `orders_paid_at_idx` (`@@index([paidAt])`) |
| `refunds` | `order_id`, `status`, `succeeded_at`, `amount_cents` | `@@index([succeededAt])` |
| `order_lines` | `order_id`, `product_id`, `product_name`, `quantity`, `line_total_cents`, `created_at` | `@@index([orderId])` |
| `refund_lines` | `refund_id`, `order_line_id`, `quantity` | `@@unique([refundId, orderLineId])`, `@@index([orderLineId])` |
| `products` | `id`, `name` | primary key |

Relationships used: `refunds.order_id → orders.id` (N:1), `order_lines.order_id → orders.id` (N:1), `refund_lines.refund_id → refunds.id` and `refund_lines.order_line_id → order_lines.id` (N:1 each), `order_lines.product_id → products.id` (N:1, nullable). If the AC-15 timing test misses its budget, an index is added then in its own migration (Follow-up), not now.

**State transitions**: none. The page is read only and changes no state.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/admin` (page, `app/admin/(panel)/page.tsx`) | GET | `period`: `today\|7d\|30d\|month\|12m` (opt), `from`: `YYYY-MM-DD` (opt), `to`: `YYYY-MM-DD` (opt) | the dashboard HTML | `requireAdmin()` (admin with TOTP, spec 0004) | bad params: default window plus notice (AC-3), never an error; a DB failure: the `app/error.tsx` page (AC-14) |
| `getSalesDashboard(window)` (`src/features/dashboard/queries.ts`, server only) | function | `SalesWindow` (current and previous `[start, end)` UTC instants, bucket unit, store day labels) | `SalesDashboard` (both windows' totals, buckets, best sellers, foreign currency count) | caller already passed `requireAdmin()`; calls nothing itself | throws on a DB error after logging (AC-14) |
| `/admin/orders` (existing page) | GET | adds `dates`: `created\|paid` (opt) | the order list filtered by `paid_at` when `paid` | `requireAdmin()` (unchanged) | an invalid `dates` is ignored (AC-13) |

No server action, route handler, cron or env variable is added.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| period parse | today (a store day) | new pure `storeToday(now, timeZone)` in `src/lib/dates.ts` (Intl `formatToParts`), fed `new Date()` after `connection()` and `STORE_TIMEZONE` (env); day arithmetic with `Date.UTC` overflow, as `admin-queries.ts` already does |
| period parse | window start and end instants | the store days from `period` or `from`/`to` (URL), turned into UTC with `zonedDayStart` (`src/lib/dates.ts`) |
| period parse | previous window | derived: same day count, ending the day before the start (AC-4) |
| period parse | bucket unit | derived from the window's day count (AC-11); `12m` always month |
| page | admin name | `requireAdmin()` result |
| Orders card | order count | `count(*)` of `orders` with `paid_at` in window, `currency = STORE_CURRENCY` |
| Net revenue card | gross | `sum(orders.total_cents)` of the same rows |
| Net revenue card | refunds | `sum(refunds.amount_cents)`, `status = 'succeeded'`, `succeeded_at` in window, joined order `paid_at IS NOT NULL` and `currency = STORE_CURRENCY` |
| Net revenue card | net | derived: gross minus refunds |
| AOV card | average order value | derived: `Math.round(gross / orders)` in TypeScript, from the two sums |
| Net units card | net units | `sum(order_lines.quantity)` of counted orders minus `sum(refund_lines.quantity)` of counted refunds |
| every card | change text | derived from this window's and the previous window's figure (AC-4), pure function |
| chart | bucket key | `to_char(date_trunc(<unit>, ts AT TIME ZONE ${tz}::text), 'YYYY-MM-DD')` in SQL on `paid_at` and `succeeded_at` (text, never a `timestamp` Prisma would read as UTC); every bucket listed by a pure TypeScript generator from the window with the same keys, empty ones filled with 0 |
| chart | bucket label | the bucket's first store day inside the window, formatted with `STORE_LOCALE` (AC-11) |
| every SQL sum or count | number | `bigint` from Postgres, through one `toSafeNumber` helper in `queries.ts` that throws when not a safe integer |
| best sellers | group key and name | `order_lines.product_id`, else `order_lines.product_name`; shown name from `products.name` when the product row exists, else the `product_name` of the line with the latest `created_at` in the group |
| best sellers | net units, sales | sums from AC-9 over `order_lines` and `refund_lines` |
| currency notice | foreign order count | `count(DISTINCT orders.id)` over orders with `paid_at` in window, or with a succeeded refund whose `succeeded_at` is in window, and `currency <> STORE_CURRENCY` |
| money text | currency and locale | `STORE_CURRENCY`, `STORE_LOCALE` (env), through `formatMoney` |
| orders link | `from`, `to` | the window's first and last store day (YYYY-MM-DD) |

**Key invariants**:
- An order counts toward revenue only through `paid_at`; a refund counts only through `succeeded_at` and only if its order has a `paid_at`. So over all time, net revenue equals the money Stripe kept for orders the store recorded as paid.
- A past window's figures never change unless a refund row's `succeeded_at` lands in it (it is set once, when the refund succeeds).
- Net revenue = gross minus refunds, in each window and in each bucket; the buckets of a window add up to the window's figures exactly.
- Money is summed as integers. Postgres `sum` of `int` returns `bigint`, read as `bigint` and turned to `number` only after checking it is a safe integer (a broken invariant throws).
- Every SQL value is a bound parameter (`$queryRaw` tagged template): instants as `${d}::timestamptz`, the time zone as `${tz}::text`; nothing is concatenated into SQL. The bucket unit (`day`, `week`, `month`) is chosen from a fixed TypeScript union and bound as text too.
- Current and previous windows are read in the same queries (one scan over `[previous start, current end)` with `FILTER` clauses), and all queries run in one `REPEATABLE READ` read only transaction, so every figure and every change comes from one snapshot.

**Security model**:
- Every signed in admin (spec 0004, TOTP required) may see the dashboard; there are no roles below admin. The page calls `requireAdmin()` itself; the proxy stays only the first gate.
- The page shows totals and product names only. It reads no email, name, address or phone, so the PII purge (spec 0008) and the customer data rules are untouched.
- Logs carry the period, the window's day count and the SQLSTATE, never row data.
- The tables keep RLS on with no policies; Prisma reads them server only, as everywhere else.

**Configuration required**: none. `STORE_TIMEZONE`, `STORE_CURRENCY` and `STORE_LOCALE` already exist in `src/lib/env.ts`. One new dependency, `recharts`, comes in through `pnpm dlx shadcn@latest add chart`.

**Recommended implementation choices** (settled here so the build does not invent them):
- **Feature folder**: `src/features/dashboard/` with `period.ts` (pure: params to `SalesWindow`, presets, clamp, previous window, buckets and labels), `change.ts` (pure: the AC-4 text), `queries.ts` (server only SQL), `components/` (`DashboardPage`, `PeriodPicker`, `StatCard`, `RevenueChart` as the only client component, `BestSellersTable`), `log.ts`. The route file stays thin. Runner up: putting it under `orders`, rejected because it also reads catalog and refund data and the orders feature is already large.
- **Queries**: three raw SQL queries inside one `db.$transaction(..., { isolationLevel: "RepeatableRead" })`, run one after another (a transaction holds one connection): totals plus buckets for orders, totals plus buckets for refunds, and best sellers (sold groups and refunded groups as two CTEs joined with `FULL OUTER JOIN` on the group key, then `LIMIT 10` after `WHERE net > 0`, plus a count of groups with net 0 or less and the overall unit sums). Runner up: Prisma `groupBy`, rejected because it cannot bucket by a time zone or join refund lines to products.
- **Timing guard**: a `dashboard.slow` warning log when the reads take over 1,000 ms in total, with the period and duration, so a slow page shows up in logs before an admin complains. Runner up: no timing log.
- **Rendering**: the page reads `searchParams` and the session, so the dashboard body sits in `Suspense` with skeletons (AC-14). `RevenueChart` gets plain serialisable bucket data as props.
- **Change rounding**: `Math.sign(x) * Math.round(Math.abs(x))` on the percent, so 0.5% reads "Up 1%" and minus 0.5% reads "Down 1%".

**Critical test scenarios**:
- Happy path: seed paid orders and refunds across two months, open `/admin?period=month`, the four cards, chart buckets and top 10 equal the sums the test computes, verifies **AC-1**, **AC-5**, **AC-6**, **AC-8**, **AC-9**, **AC-11**
- Refund timing: an order paid last month refunded this month lowers this month's net and leaves last month's unchanged; a refund of a late payment (no `paid_at`) and `pending` or `failed` refunds count nowhere, verifies **AC-6**
- Day edges: an order paid at 23:59 and one at 00:00 store time land on different days, including across a daylight saving change in `Europe/Warsaw`, verifies **AC-2**, **AC-11**
- Bad params: `from` after `to`, a 400 day range, `2026-02-30`, a future `from` each show the notice and the 30 day window; a future `to` is clamped, verifies **AC-3**
- Change text: previous 0, previous above 0 with up, down and rounding to 0, net negative previous, verifies **AC-4**, **AC-7**
- Currency: an order in another currency is left out of every figure and named in the notice, verifies **AC-10**
- Orders link: the link's list count equals the card count, `dates=paid` drops orders without `paid_at`, verifies **AC-13**
- Speed: the seeded year gives exact sums, and the median of 3 warm runs is within 1,500 ms, verifies **AC-15**
- Buckets add up: for day, week (clipped) and month (clipped) windows, the buckets' gross, refunds and net sum to the window's figures, verifies **AC-11**
- Empty and failure: an empty period shows zeros and empty texts; a failing query logs `dashboard.query_failed` and reaches the error page, verifies **AC-14**
- Auth/permission: signed out, or signed in without TOTP, `/admin` gets the admin gate answer, not the figures, verifies **AC-1**
- Access: axe clean with data and empty, the table toggle works by keyboard, no horizontal scroll at phone width, verifies **AC-12**, **AC-16**

## Build plan

Tracer Bullet: a thin thread through page, period parsing, SQL and the cards first, then each part thickened end to end.

1. Thin thread: `storeToday` in `src/lib/dates.ts`, `src/features/dashboard/period.ts` with the presets and the default window (pure, unit tested), `queries.ts` with the orders and refunds totals for the current window, `DashboardPage` with the four cards (net with gross and refunds, orders, AOV, and net units from the totals), `requireAdmin()` on `/admin`, the "Dashboard" sidebar item, the `Welcome` component deleted, skeletons in `Suspense`, `dashboard.query_failed` logging, a db test of the exact sums, an e2e smoke test, satisfies **AC-1**, **AC-2**, **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-14**
2. Period picker and comparison: the GET form, custom `from`/`to` with clamp, fallback and notice, the previous window read in the same queries with `FILTER`, `change.ts`, the change line on each card, the foreign currency count and notice, unit and db tests (day edges and daylight saving included), satisfies **AC-2**, **AC-3**, **AC-4**, **AC-7**, **AC-10**
3. Best sellers: the grouped query with the product name rule, the top 10 table, the hidden rows note and the empty text, db tests (deleted product, refunded more than sold), satisfies **AC-8**, **AC-9**
4. Chart: `pnpm dlx shadcn@latest add chart` (adds `recharts`), bucket SQL, the pure bucket generator and labels, `RevenueChart` with the `--chart-*` tokens, the "Show as table" toggle and its table, unit and db tests for buckets, satisfies **AC-11**, **AC-12**
5. Orders link: `dates=created|paid` in `src/features/orders/list-params.ts` and `admin-queries.ts`, the "Date" select in the orders filter form, the "View these orders" link, tests in the orders db and unit suites, satisfies **AC-13**
6. Safety net: the seeded year speed test with exact sums in `tests/db/`, the `dashboard.slow` log, e2e with axe (data and empty), keyboard on the picker and toggle, phone width, satisfies **AC-14**, **AC-15**, **AC-16**

## Consequences

**Positive**:
- Every figure is exact and fresh on every load, with nothing to expire when an order is paid or refunded, so no money path has to remember the dashboard.
- No schema change and no new job, so nothing new to migrate, run or watch.
- Past periods are stable (refunds on their own date), which matches Stripe payouts and makes month to month comparison honest.

**Negative / tradeoffs**:
- Net revenue for a short period can go negative after a large refund of an older order; the admin has to read it as cash flow, not as the value of that period's orders.
- Average order value uses gross, so it does not match net revenue divided by orders; the card label must stay "Average order value" with no "net".
- Best sellers cannot rank by net money, because refunds are free amounts not split per line; the table ranks by net units and shows gross line sales.
- Each load runs a few aggregate scans; if the store grows far beyond a year of tens of thousands of orders, the queries may need an index or a rollup table (the AC-15 test is the alarm).
- A new client dependency (`recharts`) on the admin bundle only.
- A cancelled paid order keeps counting as revenue until its cancel refund succeeds (the cancel action reserves a refund for everything left, spec 0010); while that refund is pending, net is higher than the money the store will keep.

**Neutral**:
- `/admin/orders` gains a `dates` param and a "Date" select, a small change in the orders feature.
- The `--chart-1` to `--chart-5` tokens reserved in `design.md` for this feature come into use.

## Follow-up

- [ ] If the AC-15 timing test misses its budget, add an index (for example `orders (paid_at) INCLUDE (total_cents, currency)`) in its own migration, measured before and after.
- [ ] Record `recharts` (through the shadcn chart component) in root `AGENTS.md` `## Stack` key dependencies and the dashboard feature in the context files list (`/sync`).
- [ ] Agent Skills for Recharts: none installed. The official `recharts/recharts` skills target Recharts contributors (`guide` writes documentation articles, so it was removed after a trial install), and no Recharts MCP server is worth adding. The build uses the `shadcn` skill plus the Recharts docs through the connected Context7 server. `/sync` may record the decline in `AGENTS.md` so it is not offered again.
