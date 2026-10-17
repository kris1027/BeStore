# Review, feat/discounts-promo-codes, 2026-10-18

**Reviewed by**: Sonnet 5.5 (author on same family, fresh context)
**Scope**: 71 files, branch vs main (plus uncommitted edits)
**Verdict**: Approve with nits

## Summary
Adds promo codes end to end: pure rule module, row locked redemption at Pay, one off Stripe coupon per order, redemption release in `markExpired`/`markCancelled`, admin CRUD with lock and stale checks, and display rows. The focus areas hold up: the code row is locked `FOR UPDATE` after the customer and cart locks and before any insert, uses are counted under that lock, the discount is recomputed from DB prices, settings and the DB clock at Pay, and every path that leaves `pending_payment` (checkout restart, reconcile cron, webhook expiry, admin cancel) goes through the two transitions that free the use. No blockers or majors; a few minors.

## Minor
### 🟡 Hot code serializes every checkout inside a 5 s interactive transaction, `src/features/checkout/actions/start-checkout.ts:381`
**Problem**: The code lock is held until the whole order transaction commits (order, lines, redemption, address save), and the Prisma interactive transaction uses the default 5 s timeout (no override in `src/lib/db.ts`).
**Why it matters**: During a campaign, many concurrent Pays on one code queue on the lock; later ones can hit the transaction timeout and surface as a thrown 500 rather than a result value.
**Suggested fix**: Raise the transaction `timeout`/`maxWait` for this transaction, or move non-essential writes (address save) out of the locked section. Acceptable to defer for a small store, but note it.

### 🟡 Stripe `amount_total == total_cents` is only asserted against mocks, `tests/db/discounts-checkout.db.test.ts:215`
**Problem**: The invariant "Stripe's amount equals our total" (coupon applies to items, never to the shipping rate) is covered by mocked `stripe.*` calls; the real hosted page check lives in the `@stripe` e2e, which is skipped unless `STRIPE_E2E=1`.
**Why it matters**: If Stripe ever spread `amount_off` over shipping, every discounted order would be flagged with an amount mismatch by the webhook and nothing in CI would catch it.
**Suggested fix**: Run the `@stripe` discount scenario at least once before merge (record it in verify.md), and consider a nightly or manual CI job for it.

### 🟡 Any Pay refusal expires the customer's earlier open session first, `src/features/checkout/actions/start-checkout.ts:103`
**Problem**: `clearPendingOrder` runs before the code is checked, so a refused code (invalid, expired, customer limit) has already ended the earlier Stripe session and freed its hold. The spec accepts this for the "used up" window only.
**Why it matters**: A customer with an open payment tab who mistypes a code loses that tab's session and, for a last use code, their own held use.
**Suggested fix**: Optional. Document it in the checkout AGENTS.md gotchas, or pre-check the code before clearing when the cart has a pending order.

## Nits
- ⚪ `src/features/checkout/schemas.ts:29`, `discountCode: z.unknown()` skips the "Zod on every input" rule at the schema; it is validated later by `parseCodeText`, so a comment or `z.string().max(64).optional().catch(undefined)`-style schema would match the convention.
- ⚪ `src/lib/dates.ts:~75`, `zonedDateTimeToUtc` accepts a wall time that does not exist (spring forward gap) and shifts it instead of returning null as its comment says.
- ⚪ `src/features/checkout/actions/start-checkout.ts:196`, reusing a coupon on `resource_already_exists` does not check its `amount_off`; safe today because the id is per order, but one comparison would make that explicit.
- ⚪ `docs/specs/0014-discounts-promo-codes/index.md` AC-19 and Code layout, spec says the migration adds an `orders.discount_code_id` index and a `queries.ts`; the index already existed (migration comment says so) and the file is `admin-queries.ts`. The migration also adds two unlisted FK indexes (reasonable). Update the spec on /sync.

## Strengths
- Locking discipline is right and documented: customer, cart, then code; admin update and delete take the same code lock first and recheck "has uses" under it, so an edit cannot race a redemption.
- One pure `evaluateDiscount` feeds Apply, prefill and Pay; the AC-2 caps (free delivery threshold, Stripe minimum) are deterministic, integer only, and BigInt in the line split.
- Use accounting covers every exit from pending (all four callers of `markExpired`, plus pending cancel); a paid order keeps its use; stale holds age out by the DB clock.
- Apply leaks only totals or a reason; logs never carry the email or the typed text of an unknown code; every admin page and action calls `requireAdmin()`; no new table so RLS rule is untouched.
- Webhook path is unchanged and idempotent; its existing amount check remains a real alarm because Stripe never computes our discount.

## Test coverage
Strong. DB tests cover the last use race for total and per email limits, refusal order, lifecycle (expire, cancel, paid kept, restart with limit 1), prefill, Pay re-reading price and shipping from the DB, DB clock expiry, coupon failure and reuse, refund suggestions on discounted orders, and admin create/update/lock/stale/delete/list/filter. Unit tests cover rule edges, split, schemas, snapshot, list params, dates and the session params. E2E covers apply, refusals, Enter runs Apply, axe and keyboard. Gaps: the real Stripe `amount_total` check is gated off by default, and there is no test of lock wait behaviour under many concurrent Pays.
