# 0010. Admin order management: rationale

## Context

Orders already reach `paid` through the Stripe webhook (spec 0006). Admins can list them (50 per page, a single "all" toggle) and open one, but they cannot do anything to it. Shipping, delivery, cancellation and refunds all live outside the store today. The schema for this work has existed since spec 0002 (`refunds`, `refund_lines`, `order_events`, the `shipped`/`delivered`/`cancelled` statuses, `tracking_number`, `carrier`). Spec 0002 left two questions for this feature: does cancelling a paid order need a refund first, and does it restock.

Refunds are the hard part. They move real money through a third party that can answer slowly, answer "pending" and fail later, or not answer at all. Refunds can also start somewhere other than the panel (the Stripe dashboard). Two admins can act on the same order at once. Stock has to come back for items that physically return, but never more than the sale took (spec 0009 keeps a stock history in which every change is a row). And `refunded_cents` feeds the revenue numbers of feature 15, so it must stay exactly equal to what Stripe refunded.

The store is small: one brand, a few admins who are all equal (spec 0004, TOTP required), at most thousands of orders. That rules out heavy machinery (queues, search engines, permission systems) and makes correctness under rare races the real risk. If this stays undecided, refunds keep happening in the Stripe dashboard with no record in the store, stock never returns, and the "needs attention" flag set by spec 0006 has no way to be cleared.

## Options considered

### Option 1: Reserve in the database, create in Stripe, settle from the reply, confirm by webhook and sync

The action locks the order, checks caps, and inserts a `pending` refund (which reserves the amount), then commits. It calls Stripe with the refund id as the idempotency key, and a second transaction applies Stripe's answer. The webhook handles `refund.*` events through the same idempotent `applyRefundOutcome`, and also records dashboard refunds. A sync in the daily reconcile cron (plus a button) settles refunds left pending. Cancelling a paid order sets `cancelled` in the same transaction that reserves the full refund of the rest, and goes back to `paid` only if Stripe refuses. So a crash midway never leaves a paid order whose money is gone.

**Pros**:
- The admin sees the final result at once in the common case (cards usually answer `succeeded` straight away).
- No lock is held across a network call. A crash at any step leaves a `pending` row that the sync can resolve without guessing.
- One code path settles a refund, whoever learns the outcome first, so double counting is impossible.

**Cons**:
- Three places can settle a refund (reply, webhook, sync), which needs careful tests of every interleaving.
- A request that got no answer blocks the order's actions for up to 10 minutes.

### Option 2: Webhook only refund accounting

The action only asks Stripe for a refund. Nothing about money changes in the store until the `refund.*` webhook arrives, and the webhook is the only writer, like `markPaid` for payments.

**Pros**:
- Mirrors the spec 0006 rule "only the webhook marks paid", so there is one writer for money.
- Fewer code paths to test.

**Cons**:
- Every refund shows "pending" after the click, even when Stripe already said succeeded, and locally it depends on `stripe listen` running.
- Without a reservation row written before the call, two admins can both pass the remaining amount check. Adding that row brings back most of Option 1's complexity anyway.
- Cancel cannot know whether to change the status until the webhook lands, which turns cancel into a two phase state the schema does not have.

### Option 3: Refund in the Stripe dashboard, mirror only

The panel gets status actions and notes, but refunds stay in the Stripe dashboard. The webhook mirrors them into `refunds` as system refunds.

**Pros**:
- The least code. Stripe's own UI handles amounts and confirmations.
- No idempotency or race handling in the store's actions.

**Cons**:
- Refunds have no lines, so restock is impossible, which fails the scope's "a refund returns stock when chosen".
- The history cannot say which admin refunded or why.
- Cancelling a paid order cannot guarantee the money went back.

## Rationale

Option 1 is the only one that meets every requirement in the scope row: refund through the payment provider, restock when chosen, and a history of who did what. Option 3 fails the restock and audit needs outright. Option 2 looks purer, but the forces in Context break it. Two admins can race, so the store needs a reservation before Stripe is called. Once that row exists, applying Stripe's synchronous reply is a small step that turns "pending" into a final answer in the common case. The webhook stays as the confirmation and correction path, so spec 0006's principle (trust only verified Stripe data for money) still holds. The reply comes from an authenticated API call with the secret key, the same trust level the reconcile cron already uses.

The three settlement paths are safe because they share one function whose update only moves a refund out of `pending`. That is the same "guard on the from state, zero rows means someone else did it" pattern spec 0006 uses for orders, so the team already knows it. Keeping Stripe calls outside transactions follows from the operational reality of a serverless function: a lock held across a network call is a lock held during a timeout, and a crash between "Stripe said yes" and "commit" must leave something the sync can find. The pending row with the refund id in Stripe's metadata is exactly that.

Answering spec 0002's open questions: cancelling a paid order refunds the rest (the engineer's pick), because a cancelled order that still holds the customer's money is the worst state an order page can show. Restock is chosen per line and happens on success, because only succeeded refunds mean the money moved. A pending refund that fails later must not have put phantom stock on the shelf. The restock cap reads the stock history (spec 0009) rather than the order line, so a line that sold short never "returns" stock that was never taken.
