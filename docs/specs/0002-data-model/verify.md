# Verify: data model · spec 0002 · updated 2026-09-24
_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Commands
- [x] Drop and recreate the local dev DB schema (`prisma migrate reset --force`), then `pnpm db:migrate` → exactly one migration (`*_data_model`) applies, 23 app tables plus `_prisma_migrations` exist → AC-1
- [x] `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` → "No difference detected", exit 0 → AC-1
- [x] `pnpm typecheck` → passes against the generated client → AC-1
- [x] Query `pg_class` for `public` tables where `relrowsecurity = false` → no rows (including `_prisma_migrations`); `select count(*) from pg_policies where schemaname = 'public'` → 0 → AC-2
- [x] `pnpm exec supabase db advisors --local --type all --level warn` → no issues → AC-2
- [x] `update product_variants set stock_quantity = -1` → CHECK violation 23514; `update ... set stock_quantity = stock_quantity - n where stock_quantity >= n` with n above stock → 0 rows → AC-4
- [x] `select * from store_settings` → one row: id 1, flat_shipping_cents 0, free_shipping_threshold_cents null; `insert into store_settings (id) values (2)` → fails → AC-9
- [x] On an empty DB, create two orders → numbers 1001 and 1002 → AC-12
- [x] `pnpm db:seed` twice → both succeed; 3 products, 10 variants, 2 categories, no duplicates → AC-13
- [x] `DIRECT_URL=postgresql://u:p@db.example.com:5432/postgres pnpm db:seed` → refuses, exit 1, names the host; with `-- --yes` it passes the guard (then fails to connect) → AC-13
- [x] `pnpm test:db` → migrates `bestore_test` and all db suites pass; `pnpm test` passes with no database running → AC-14
- [x] Unset `TEST_DATABASE_URL`, or set it to the `DIRECT_URL` value, then `pnpm test:db` → refuses before running any migration → AC-14
- [x] Push the branch → the CI `check` job starts a Postgres 17 service and `pnpm test:db` passes there → AC-14

## Constraint behavior (covered by `pnpm test:db`, spot check by hand if wanted)
- [x] Rename the product, reprice and archive the variant → the order line keeps name, label, SKU, image path and unit price; hard delete the product in SQL → line survives with `variant_id` and `product_id` null → AC-3
- [x] Duplicate option combination, SKU, product slug, category slug, promo code → each 23505; lowercase promo code → 23514 → AC-5
- [x] Orders whose total does not add up, discount above subtotal, refunded above total, total 0, or a negative amount → each 23514; order line with a wrong `line_total_cents` → 23514 → AC-6
- [x] Guest order with no customer saves; order with no email → 23502; deleting a customer removes addresses and cart, orders keep `customer_id = null` → AC-7
- [x] Second `stripe_events` id, second `email_sends` dedupe key, second redemption for an order, second `pending_payment` order for a cart → each 23505 → AC-8
- [x] Second default address, second cart for a customer, second line for the same variant in a cart, cart quantity 0 → each rejected → AC-10
- [x] Deleting an admin named on an order event or refund → 23503; `actor_type = admin` without an admin, or another actor with one → 23514 → AC-11
- [x] Two concurrent redemptions for the last use of a code (lock, count, insert) → exactly one succeeds → AC-15

## Value sourcing
- [x] `orders.number` comes from the DB sequence: a raw SQL insert without `number` gets the next value from 1001 → Value sourcing (order number)
- [x] `created_at`/`updated_at` are `timestamptz`: `select data_type from information_schema.columns where column_name in ('created_at','updated_at','paid_at')` → all `timestamp with time zone` → Value sourcing (any write)
- [x] Every `*_cents` column is `integer` → Value sourcing (money)
- [x] Seed rows come from `prisma/seed.ts` constants: seeded variants' `option_key` equals their sorted option value ids; the simple product's is `''` → Value sourcing (seed)
- [x] `pnpm test:db` connects only to `TEST_DATABASE_URL` (locally `bestore_test`), never the dev DB: dev DB product count is unchanged after a test run → Value sourcing (test connection)
- [x] Later slices own the remaining rows (checkout snapshots, webhook times, refunds, emails, cart expiry); the schema only needs columns for them, checked by the AC-1 drift step

## Acceptance-criteria coverage
- AC-1 migrate, drift, typecheck steps · AC-2 RLS query and advisors · AC-3 snapshot · AC-4 stock steps · AC-5 uniqueness · AC-6 money CHECKs · AC-7 guests and deletion · AC-8 once only records · AC-9 settings row · AC-10 addresses and carts · AC-11 admin restrict and actors · AC-12 numbering · AC-13 seed twice and host guard · AC-14 test:db, guard, CI · AC-15 promo race
