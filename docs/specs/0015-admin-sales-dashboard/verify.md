# Verify: Admin sales dashboard · spec 0015 · updated 2026-10-19
_Steps derived from spec 0015 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Sign in as an admin with TOTP and open `/admin` → you see the `h1` "Dashboard", "Signed in as <name>", the picker, four cards (Net revenue, Orders, Average order value, Net units sold), the chart and Best sellers, in that order → AC-1
- [x] Look at the sidebar on `/admin`, then on `/admin/orders` → "Dashboard" is the first item; it has `aria-current="page"` only on `/admin` → AC-1
- [x] Open `/admin` signed out, and signed in as a non admin → the admin gate answers (sign in redirect, or the store 404), never the figures → AC-1
- [x] Open `/admin` with no params, then `?period=bogus` → Last 30 days (today and the 29 days before, in `STORE_TIMEZONE`) → AC-2
- [x] Try each preset (`today`, `7d`, `30d`, `month`, `12m`) → the "Showing … compared with …" line gives the right store days; `12m` starts on the 1st of the month 11 months back → AC-2
- [x] Open `?from=2026-08-01&to=2026-08-31&period=7d` → the custom range wins, and the select shows "Custom range" → AC-3
- [x] Open `?from=<today minus 5>&to=<a date next year>` → the end is clamped to today, with no notice → AC-3
- [x] Open `?from=2026-02-30&to=2026-03-05`, `?from=2026-10-10&to=2026-10-01`, `?from=<tomorrow>&to=<next week>`, `?from=2024-01-01&to=2026-01-01`, `?from=2026-10-01` → each shows "That date range can't be used. Showing the last 30 days." and the 30 day window → AC-3
- [x] Turn JavaScript off and submit the picker → it still works as a GET form → AC-3
- [x] Pick "This month" → the comparison line names the same number of days ending the day before the 1st (on Oct 18: Sep 13 to Sep 30) → AC-4
- [x] Compare a period whose previous window had sales → "Up N%", "Down N%" or "No change" plus "vs previous <n> days"; one with no earlier sales → "No earlier figure to compare" with no suffix → AC-4
- [x] Check an order paid in the window that is now `cancelled` → it still counts in Orders and Gross → AC-5
- [ ] Refund (succeeded) an order paid last month → this month's Net and Refunds drop; last month's figures don't change → AC-6
- [ ] Choose a period with no orders → Average order value shows "No orders", and its line says "No orders in this period" when the previous window had orders → AC-7
- [ ] Refund one unit with a line → Net units sold drops by 1 → AC-8
- [ ] Best sellers: a live product links to `/admin/products/<id>` with its current name; a deleted product shows its line name with no link; a product only refunded in the window is left out, and the "Units refunded for products not listed here…" line shows → AC-9
- [x] Pay an order in another currency in the window → "1 order in another currency is left out of these figures." and no figure moves → AC-10
- [ ] Check the chart for 7 days, about 90 days and 12 months → bars per day, per week ("Week of …", clipped to the window) and per month ("Oct 2026"); a day with refunds over sales goes below zero → AC-11
- [x] Press "Show as table" by keyboard → `aria-expanded` flips, the table (Period, Gross, Refunds, Net, with a caption) shows the same buckets, and "Hide table" hides it; the chart SVG is hidden from screen readers → AC-12
- [x] Click "View these orders" → `/admin/orders?status=all&dates=paid&from=…&to=…`, the Date select shows "Paid", and the list's rows (across pages) equal the Orders card → AC-13
- [x] On `/admin/orders`, set Date to "Paid" with no From or To → only unpaid orders drop out → AC-13
- [x] Throttle the network → skeletons show for the cards, chart and table while the figures load → AC-14
- [x] At 375px width → the cards stack and the page has no horizontal scroll → AC-16

## Value sourcing
- [x] Today: open `/admin?period=today` just after midnight in `STORE_TIMEZONE` (or with the server in another zone) → the window is the store's day, not UTC's → AC-2
- [ ] Day edges: an order paid at 23:59:59 and one at 00:00 store time, including on a daylight saving change day in `Europe/Warsaw` → they land on different chart days → AC-2, AC-11
- [x] Currency: change `STORE_CURRENCY` locally → orders in the old currency move into the notice and out of every figure → AC-10
- [x] Locale: set `STORE_LOCALE=pl-PL` → money, counts and chart labels use Polish formats → AC-10, AC-11
- [x] Orders link `from`/`to`: they equal the window's first and last store day → AC-13
- [ ] Average order value: gross 1001 cents over 2 orders shows 5.01 (half up) → AC-7

## Commands
- [x] `pnpm test` → `period.test.ts`, `change.test.ts`, `dates.test.ts`, `list-params.test.ts` pass → AC-2 to AC-4, AC-7, AC-11, AC-13
- [x] `pnpm test:db` → `dashboard.db.test.ts` (exact sums, refund timing, currency, buckets add up, best sellers, orders link, failure logging) and `dashboard-year.db.test.ts` (a seeded year: exact figures, median of 3 warm runs within 1,500 ms, 144 ms measured locally) pass → AC-5 to AC-11, AC-13 to AC-15
- [x] `pnpm test:e2e tests/e2e/admin/dashboard.spec.ts` → figures, table toggle, orders link, empty period, bad range notice, keyboard, nav and phone width pass with axe clean on both projects → AC-1, AC-3, AC-12, AC-13, AC-16
- [ ] Read the log of a forced DB failure → `dashboard.query_failed` with `code` (the SQLSTATE) and no Postgres message; the `app/error.tsx` page shows → AC-14

## Acceptance-criteria coverage
- AC-1 … nav and page steps, e2e · AC-2 … presets, today, day edges · AC-3 … custom range and notice steps · AC-4 … comparison steps · AC-5 … cancelled order step · AC-6 … refund timing step · AC-7 … no orders, half up · AC-8 … refunded unit step · AC-9 … best sellers step · AC-10 … currency steps · AC-11 … chart and day edge steps · AC-12 … table toggle step · AC-13 … orders link steps · AC-14 … skeleton and failure log steps · AC-15 … seeded year command · AC-16 … phone width step, e2e axe
