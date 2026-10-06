# Review, feat/admin-order-management, 2026-10-06

**Reviewed by**: Sonnet 5.5 (author on the same family; fresh context)
**Scope**: 58 files (+3 untracked tests), branch vs main
**Verdict**: Changes requested

## Summary
Adds admin order management: ship/deliver/undo/tracking, notes, attention flag, refunds (reserve, Stripe call outside a tx, settle), cancel, refund webhooks, a refund sync in the reconcile cron, and restock with `return` stock movements. The core design is sound: order row lock first, refund row lock second, pending refunds count against the remaining amount, the refund id is the Stripe idempotency key, restock is guarded by `NOT restocked`, and every action calls `requireAdmin()` and parses with Zod. One major functional gap (late payment on a cancelled/expired order cannot be refunded in the app) and a few minors.

## Major
### 🟠 Late payment on a cancelled or expired order cannot be refunded in-app, `src/lib/orders/transitions.ts:194`
**Problem**: `flagLatePayment` sets `needs_attention` and writes the "refund it" note but never stores the session's `payment_intent` on the order. `refundOrder` (`admin-actions.ts:406`) then returns `invalid_transition` because `paymentIntentId === null`, and the page still offers Refund on a cancelled order (`statusAllows` does not look at the intent). `expired` orders get no refund action at all. Refund webhooks for that payment also fall to `not_ours` (`stripe-events.ts:113`, lookup by `stripePaymentIntentId`), so a dashboard refund is never recorded.
**Why it matters**: The one path AC-15 adds to "never silently keep money" ends in a misleading "This order changed. Reload" error, and a dashboard refund leaves the order showing nothing refunded.
**Suggested fix**: In the late payment branch, save the payment intent id from the event (guarded so it only fills a null), and let refund eligibility include `expired` for that case or document dashboard refund as the path. Add a db test: cancel pending, replay a paid event, refund.

## Minor
### 🟡 `StripeIdempotencyError` treated as "no refund exists", `src/features/orders/refunds.ts:130`
**Problem**: A 409 `idempotency_key_in_use` means the first request is still running, so the refund may exist. It is classed as refused (matches AC-12 text) and marks the row failed; for cancel it also reverts to paid.
**Why it matters**: Self-heals via webhook (failed to succeeded reopens and flags), but leaves a paid order with a succeeded full refund.
**Suggested fix**: Treat only a key reused with different parameters as refused; treat in-use as unknown. Amend AC-12.

### 🟡 Cancel of a pending order races the expiry webhook, `src/features/orders/admin-actions.ts:588-616`
**Problem**: `sessions.expire` fires `checkout.session.expired`, which can run `markExpired` and bump `updated_at` before the second guard, so the admin gets "stale" and the order ends `expired`, not `cancelled`.
**Why it matters**: Order is safe (no money) but the reason and actor are lost and the admin sees an error after a successful expire.
**Suggested fix**: In the second transaction, treat "now expired" after a clear gate as success, or compare only status, not `updated_at`.

### 🟡 Refund sync can starve and is skipped when reconcile throws, `src/features/orders/refund-sync.ts:85`, `reconcile.ts:173`
**Problem**: Oldest 100 pending refunds are retried every run; 100 that keep throwing (or stay `unknown`) block newer ones. `syncPendingRefunds` also runs only after `reconcileOrders` returns.
**Suggested fix**: Order by last checked time or exclude unknown-status rows; run the refund sync in its own try block.

### 🟡 Fully refunded paid order can still be shipped, `src/features/orders/order-actions.ts:26`
**Problem**: `ship` ignores `remainingCents`, so a goodwill refund of the whole total leaves a Ship button.
**Suggested fix**: Confirm intent with spec; if unintended, require remaining > 0 for ship.

### 🟡 Cancelled-then-async-refund-failure leaves order cancelled, `src/features/orders/admin-actions.ts:566`
**Problem**: Cancel is undone only when the immediate answer fails. A later `refund.failed` (webhook or sync) only flags. The order stays `cancelled` with its stock not returned and money held.
**Suggested fix**: Acceptable per AC-9 ("cancel refund that later failed" is refundable), but confirm the flag text tells the admin to refund again.

## Nits
- ⚪ `src/features/orders/schemas.ts:12`, `min(1001)` hard-codes the first order number; derive from the sequence start or drop the lower bound.
- ⚪ `src/features/orders/admin-actions.ts:565`, `let undone` mutated from a closure; return it from `settle` instead.
- ⚪ `prisma/schema.prisma:246`, comment line exceeds the file's wrap width.
- ⚪ `src/features/orders/AGENTS.md`, not updated for the new files (order-lock, refunds, refund-sync, admin-actions); /sync should cover it.

## Strengths
- Money race handling is careful: lock order then refund row, pending counts as reserved, telescoping floor math sums to the exact line total, refund id as idempotency key, no transaction held across Stripe calls.
- Restock is idempotent (`NOT restocked`, CHECKs tie `restock`, `restocked`, `returned_quantity`), caps at sale minus prior returns, locks variants in id order like `markPaid`.
- Cache tags: `updateTag` in server actions, `revalidateTag(..., {expire:0})` in webhook and cron, only when stock changed.
- Webhook idempotency: `stripe_events` insert shares the transaction; the reopen, late failure and over-total cases are all handled and flagged.
- All 8 actions call `requireAdmin()` first; every input goes through Zod; amounts come from DB rows; Stripe never gets the admin's reason.

## Test coverage
Strong: pure refund math, order-actions, schemas, list params, messages and lock helpers have unit tests; `tests/db` has about 877 lines for refunds plus status actions, webhook and reconcile; an e2e spec covers the admin flow. Untested: late payment then refund (Major above), the pending-cancel versus expiry-webhook race, `StripeIdempotencyError` in-use handling, and refund sync starvation.
