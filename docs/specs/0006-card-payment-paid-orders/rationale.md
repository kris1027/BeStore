# 0006. Card payment and paid orders: rationale

Decision record for [index.md](index.md). `/develop` builds from `index.md`; this file holds the why.

## Context

BeStore can show a product and hold it in a cart, but it cannot take money. Scope feature 7 closes the walking skeleton: a guest pays by card, the payment is confirmed on the server, and the paid order appears in admin. It is tagged GA because it moves money and stock, and a mistake here either charges a customer without an order, sells stock that does not exist, or creates an order nobody paid for.

Earlier specs fix most of the frame. Spec 0001 chose Stripe's hosted Checkout page (card data never touches BeStore, PCI DSS SAQ A) and made the Stripe webhook the only thing that marks an order paid, idempotently. Spec 0002 built every table this feature needs, with the rules that matter enforced by Postgres: stock never negative, totals that add up, one `pending_payment` order per cart, each Stripe event recorded once, an email on every order, and stock taken only on `pending_payment → paid`. Spec 0005 left `/checkout` as a read only summary and named the cache tags the webhook must expire when stock changes.

The forces that remain are about timing and failure. Stripe confirms a payment in a separate request that can arrive late, twice, out of order, or (after an outage) not at all; the customer's browser comes back on its own schedule and cannot be trusted. The engineer chose to offer whatever payment methods are switched on in the Stripe dashboard, which includes methods that confirm hours or days later or fail after the customer has left. Stock is not held while the customer is on Stripe's page, so two people can pay for the last unit. A customer can also press Pay twice, in two tabs, or come back from Stripe and press it again.

Compliance: PCI DSS (kept at SAQ A by the hosted page) and GDPR for the email address. Without a decision, `/develop` would have to invent when the order row is created, which messages count as paid, how a second Pay is handled, and what happens when a webhook is lost.

## Options considered

### Option 1: Pending order at checkout start, webhook marks paid, daily reconcile replay

The Pay action freezes the cart into a `pending_payment` order (lines, prices, totals) and builds the Stripe session from that order. The signed webhook moves the order to `paid` or `expired` in one transaction with the `stripe_events` insert and the stock decrement. A second Pay first expires the old session at Stripe. A daily cron finds orders stuck in `pending_payment` and replays the real Stripe event through the same handler.

**Pros**:
- The customer pays exactly the prices frozen on the order; the Stripe total is derived from it and checked again on the way back.
- The order exists before payment, so the email, a future promo code redemption and a future shipping address attach to it naturally (spec 0002 already assumes this).
- One handler decides paid; idempotency sits in the database, not in memory.
- A lost webhook is recovered without a human.

**Cons**:
- Abandoned checkouts leave `expired` orders in the table (hidden by default in admin).
- More moving parts on restart: Stripe must confirm the old session is dead before a new order is created.
- The reconcile cron is code that rarely runs, so it needs its own tests to stay honest.

### Option 2: Create the order only in the webhook

No order until Stripe says paid. The session carries the cart id in metadata; the webhook reads the cart, snapshots it, creates a `paid` order and takes stock in one go.

**Pros**:
- No pending or expired rows at all.
- Fewer states and no restart logic.

**Cons**:
- The snapshot is taken after payment from the live cart, which the customer may have edited in another tab while paying; the order can differ from what Stripe charged.
- Contradicts spec 0002 (email required before payment, one pending order per cart, promo redemption at checkout start).
- The confirmation page has no order to show until the webhook lands, and a failed delayed payment leaves no record of the attempt.

### Option 3: Embedded payment form on BeStore's own page

Use Stripe's embeddable checkout or Payment Element inside `/checkout`, keeping the customer on the store's domain, with the same order and webhook design behind it.

**Pros**:
- Full control of the page look and one fewer redirect.
- The confirmation state can appear without a page change.

**Cons**:
- Spec 0001 chose the hosted page; this reopens that decision for looks alone.
- More front end code, more accessibility surface, and a wider security surface on BeStore's own page (scripts, CSP).
- The webhook and order design are unchanged, so the hard part is not made easier.

### Option 4: Option 1, but hold stock at checkout start

Take stock when the pending order is created and give it back when the order expires.

**Pros**:
- No shortfall can happen; a paid order always has its stock.

**Cons**:
- Abandoned checkouts lock stock for up to 30 minutes (hours for delayed methods), so a small catalog can look sold out while nobody is buying.
- Every expiry path (webhook, restart, cron) must restore stock exactly once, which multiplies the places stock can go wrong.
- Changes spec 0002's rule. The engineer chose to keep it.

## Rationale

Option 1 is the only one that satisfies the scope's "done when" together with specs 0001 and 0002 without reopening them. Freezing the order before payment is what makes "the customer pays the prices they saw" true, and it is the row every later feature (shipping address, promo codes, emails, refunds) hangs off. Option 2 is simpler on paper, but it takes the snapshot at the wrong moment and breaks the data model's assumptions; Option 3 buys looks with more code and more security surface; Option 4 trades a rare, visible shortfall for common, invisible stock lockups, and the engineer chose the shortfall.

The failure handling follows from Stripe's delivery model. Events can repeat, so the `stripe_events` insert and the change share a transaction and the status guard makes a second paid event a no op. Delayed methods (the engineer's choice of dashboard payment methods) split "session completed" from "money received", so the pure decision step reads `payment_status` and waits for the async events; a failed delayed payment becomes `expired`, reusing a terminal state instead of adding an enum value that every later feature would have to handle. Restart expires the old session at Stripe before anything local changes, because a local `expired` while Stripe can still take money is exactly the "paid but no order" failure. The reconcile cron replays real Stripe events rather than inventing a second "mark paid" path, so the rule "only a verified Stripe event marks paid" still holds; it widens the AGENTS.md wording, which is flagged for `/sync`.

On shortfall, taking what stock there is (instead of skipping the line) keeps the shelf count true, and the order is flagged for a manual refund in the Stripe dashboard until feature 10 builds refunds. That is acceptable for a small single brand store, where two buyers racing for the last unit within 30 minutes is rare and always visible. A 30 minute session is Stripe's shortest window and keeps that race short.

## Evidence: what earlier specs already fixed

| Fixed by | Rule this spec builds on |
|---|---|
| 0001 | Hosted Stripe Checkout; the webhook is the only path to paid, verified and idempotent; route handlers only for the webhook, auth callback and cron; Stripe test mode everywhere but production; payment flows tested locally or on staging, not on preview URLs |
| 0002 | `orders`, `order_lines`, `order_events`, `stripe_events` with their CHECKs and uniques; one `pending_payment` order per cart; stock taken at paid with a conditional update; shortfall sets `needs_attention` and writes `stock_shortfall`; email required before payment; order number from 1001; snapshot sources for every line field |
| 0005 | `/checkout` rereads the cart; `src/lib/cart/` is shared; the webhook expires `catalog` and `product:<slug>` with `revalidateTag(tag, { expire: 0 })`; cron handlers use a constant time bearer check |
