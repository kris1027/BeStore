# Review, feat/data-model, 2026-09-24

**Reviewed by**: Claude Sonnet 5 (author on Claude Sonnet 5)
**Scope**: 30 files (29 excluding the lock file), branch vs main (merge base fa333976c4f744352f5fdfda2097faaef00c6e8)
**Verdict**: Approve with nits

## Summary

This change lands the whole BeStore data model in one migration: catalog, people, cart, orders, refunds, promo codes and operations tables, with CHECK constraints, RLS, and a real Postgres test suite that runs against a dedicated test database. You built this carefully. I read every changed file and also ran the change for real: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db` (against your local Supabase Postgres), `prisma migrate diff` (no drift), and `supabase db advisors` all pass cleanly. The schema in `prisma/schema.prisma` matches the raw SQL in the migration and matches the spec table by table, and the 66 db tests in `tests/db/*.db.test.ts` genuinely exercise the constraints they claim to, not just the happy path. I found no blockers and no majors, only a couple of small test coverage gaps and one style nit.

## Minor

### 🟡 A few CHECK constraints have no covering test, `prisma/migrations/20260924192719_data_model/migration.sql:611-658`
**Problem**: The migration adds `orders_discount_value_check` (line 612), `order_lines_tax_cents_check` and `order_lines_tax_rate_bps_check` (lines 624-625), `refund_lines_quantity_check` (line 639), `discount_codes_max_redemptions_check` / `per_customer_limit_check` / `min_subtotal_cents_check` (lines 647-649), and `store_settings_free_shipping_threshold_cents_check` (line 658). None of these is violated in `tests/db/*.db.test.ts`.
**Why it matters**: The spec's own critical test scenario promises "each CHECK and unique rule in the sketch is violated once and rejected" (index.md, Critical test scenarios). These are simple, low risk constraints, so the gap is small, but it is a real gap against what the spec committed to, and a future refactor could silently drop one of these CHECKs without a test noticing.
**Suggested fix**: Add one `expectViolation` case per constraint (they can mostly reuse the existing `it.each` patterns already used for `discount_codes_value_check`).

## Nits

- ⚪ `tests/db/fixtures.ts:95`, `let customerCount = 0` is shared mutable module state, which AGENTS.md's functional style rule asks you to avoid even though this is test-only helper code. A suffix parameter (like the other builders already take) or `crypto.randomUUID()` in the email would remove it.

## Strengths

- Every acceptance criterion in the spec maps to a real, passing test, and I verified this by actually running `pnpm test:db` against your local Postgres stack rather than trusting the file contents; all 66 db tests and both concurrency races (stock decrement, promo redemption) passed.
- The Postgres-error-matching helper in `tests/db/client.ts` (`expectViolation`, matching on SQLSTATE via `driverAdapterError.cause`, not a guessed Prisma error code) is exactly what the spec asked for and is reused consistently across every test file.
- `prisma migrate diff --exit-code` reports no drift and `supabase db advisors` reports no issues, so the raw SQL CHECKs and RLS statements really are invisible to Prisma but genuinely applied.
- The snapshot test (`tests/db/orders.db.test.ts`, "snapshots survive catalog changes") bypasses the app-level "archive, never delete" rule with a raw `DELETE` to prove the FK `SetNull` safety net actually holds, which is the right way to test a safety net.
- `tests/db/guard.ts` and `prisma/seed-guard.ts` both compare the parsed host/port/database, not the raw string, so a `?pgbouncer=true` or a `localhost` vs `127.0.0.1` mismatch cannot disguise the dev database; this is tested directly in `tests/db/guard.test.ts`.

## Test coverage

Excellent and verified live. All 15 acceptance criteria (AC-1 through AC-15) have at least one real test, most have several, and I re-ran the whole `pnpm test:db` suite (66 tests, 6 files) plus `pnpm test` (59 unit tests) against the actual local Supabase Postgres and everything passed. The only gap is the handful of untested CHECK constraints noted above under Minor; these are all simple range/positivity checks on columns not yet written to by any application code, so the risk is low.
