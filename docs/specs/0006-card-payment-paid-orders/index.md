# 0006. Card payment and paid orders

**Date**: 2026-09-27
**Amended**: 2026-09-28, to match the shipped code after review (31 minute session, `created` row actor, reconcile flagging and per order failures, restart on an order that expired meanwhile, confirmation page when Stripe is unreachable)
**Status**: Accepted

## Summary

This spec turns the checkout summary into a real sale. The customer types an email and presses Pay; the server rereads the cart, saves a `pending_payment` order with a frozen copy of the lines, and sends the customer to Stripe's hosted payment page. Only the Stripe webhook (a signed message Stripe sends to the store) marks the order paid, takes the stock and deletes the cart, exactly once even when Stripe sends the same message twice; a daily job replays any message that got lost. Admins get an order list and an order page, and the customer gets a confirmation page that never changes anything itself.

## Requirements

**User stories**:
- As a customer, I want to pay for my cart by card, wallet or a local method my bank supports, so I can buy without creating an account.
- As a customer, I want to see my order number and what I bought right after paying, and to be told plainly when a payment is still processing or did not go through.
- As the store owner, I want every successful payment to become exactly one paid order that takes stock, and nothing else ever to become paid, so money and stock always agree.
- As an admin, I want to see paid orders with their lines and totals, and to spot an order that needs my attention.

**Acceptance criteria**:
- **AC-1**: On `/checkout` with a clean cart, the customer enters an email and presses Pay. The server rereads the cart under a row lock and, in one transaction, creates one `pending_payment` order (number from the sequence, email trimmed and lowercased, `currency` from `STORE_CURRENCY`, `shipping_cents` 0, lines copied from current database prices, one `created` event), then creates a Stripe Checkout Session for exactly those lines and that total (expires in 31 minutes, email prefilled, payment methods taken from the Stripe dashboard), saves the session id on the order, and sends the browser to Stripe.
- **AC-2**: An invalid email shows a field error and creates nothing. A missing cart, an empty cart or any flagged line at submit creates nothing and sends the customer to `/cart`, where the reason shows. A total below Stripe's minimum charge for the store currency shows a clear message and creates nothing.
- **AC-3**: `POST /api/stripe/webhook` with a missing or invalid `Stripe-Signature` answers 400 and changes nothing.
- **AC-4**: For `checkout.session.completed` with `payment_status = paid`, or `checkout.session.async_payment_succeeded`, on a `pending_payment` order, one transaction: records the event in `stripe_events`, sets the order `paid` with `paid_at` = the event time and the payment intent id, decrements each line's variant stock by its quantity, writes one `status_changed` event (actor `system`), and deletes the cart. After it commits, the `catalog` tag and each affected `product:<slug>` tag are expired, so the storefront shows the new stock.
- **AC-5**: The same event delivered twice, or two different paid events for one order (for example `completed` then `async_payment_succeeded`), end with exactly one paid transition, one stock decrement per line, and one `status_changed` event.
- **AC-6**: `checkout.session.completed` with `payment_status = unpaid` (a delayed method) leaves the order `pending_payment` and stock unchanged. A later `checkout.session.async_payment_failed` sets it `expired` with an event saying the payment failed; `checkout.session.expired` sets it `expired` with an event saying the session expired. Leaving `pending_payment` for `expired` never touches stock. A failed or abandoned payment never creates a paid order.
- **AC-7**: When a paid order's variant has less stock than the line needs (or the variant no longer exists), the order still becomes `paid`, the stock that is there is taken (never below 0), `needs_attention` is set, and one `stock_shortfall` event names each short SKU and the missing quantity.
- **AC-8**: When the session's `amount_total` or `currency` differs from the order's `total_cents` or `currency`, the order still becomes `paid` (the money was taken), `needs_attention` is set, a `note` event records both amounts, and an error is logged.
- **AC-9**: Paying twice for one cart is impossible. Pressing Pay while the cart already has a `pending_payment` order first expires that order's Stripe session and marks the order `expired`, then creates the new one. If Stripe reports the earlier session already completed, no new order is created: a paid order sends the customer to its confirmation page, a processing one shows "A payment for this cart is still processing". Two Pay submissions for one cart at the same moment end with one pending order.
- **AC-10**: Cancelling or going back on the Stripe page returns the customer to `/checkout` with the notice "Payment was not completed. Your cart is saved." and the cart unchanged.
- **AC-11**: `/checkout/complete?session_id=…` never changes an order. A `paid` (or later) order shows its number, lines, total, masked email and status. A `pending_payment` order whose session Stripe reports as complete and paid shows "Confirming your payment" and refreshes itself every 3 seconds for up to 60 seconds, then shows "This is taking longer than usual" with the order number. A session complete but unpaid shows "Your payment is processing". An expired order, an open session, or an unknown or malformed session id shows "Payment not completed" with a link to `/checkout`. The page sends `noindex` and `Referrer-Policy: no-referrer`.
- **AC-12**: `/admin/orders` lists orders newest first, 50 per page, with number, date (in `STORE_TIMEZONE`), email, status, item count, total and a "Needs attention" badge. By default it shows `paid`, `shipped`, `delivered` and `cancelled`; an "All orders" toggle adds `pending_payment` and `expired`. It shows an empty state when there are none. The admin nav gains "Orders".
- **AC-13**: `/admin/orders/[number]` shows the order's lines from their snapshot (name, variant label, SKU, unit price, quantity, line total), subtotal, shipping, total, email, status, created and paid times, the Stripe session and payment intent ids (linked to the Stripe dashboard), and its event history. An order with `needs_attention` shows a banner saying why and that refunds are done in the Stripe dashboard until feature 10. An unknown number shows the not found state.
- **AC-14**: Both admin pages call `requireAdmin()`; a visitor who is not an admin gets a real 404 from the proxy.
- **AC-15**: `GET /api/cron/reconcile-orders` refuses anything but `Authorization: Bearer ${CRON_SECRET}` (401). For each `pending_payment` order older than 90 minutes it asks Stripe for the session and replays the decisive Stripe event through the same handler the webhook uses, so a lost paid event ends paid exactly once; an order with no session id is set `expired`; an order whose session Stripe reports complete or expired but that no event found in the search resolves (none found, or only one that leaves it processing) gets `needs_attention` and an error log. If one order fails (a database error), it is logged and counted as skipped, and the run carries on with the rest. It returns the counts and runs daily from `vercel.json`.
- **AC-16**: A validly signed event that is not for a BeStore order (no `order_id` in its metadata, or an unknown order), an event of a type the store does not handle, and an event for an order already past `pending_payment` answer 200, are recorded in `stripe_events`, and change nothing else. When processing throws, the route answers 500, the whole transaction (including the `stripe_events` row) rolls back, and Stripe's retry processes it again.
- **AC-17**: The checkout, webhook, cron and admin paths log the events listed in *Observability*, with order ids and numbers but never an email address or any card detail.
- **AC-18**: The checkout form, the confirmation page and both admin pages work by keyboard, announce errors and status changes to screen readers, and pass axe with no violations.
- **AC-19**: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are validated in `src/lib/env.ts` (format checked) and listed in `.env.example`; the server refuses to start without them.

## Decision

**Chosen option**: Option 1: Pending order at checkout start, hosted Stripe Checkout, webhook as the single path to paid, stock taken at paid, daily reconcile replay

The checkout action freezes the cart into a `pending_payment` order and a Stripe Checkout Session built from that order; the signed webhook (and the reconcile cron replaying real Stripe events through the same handler) is the only code that moves an order out of `pending_payment`, idempotently, with stock taken in the same transaction.

**Implementation skills**: `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `accessibility` (`.agents/skills/accessibility/`) · `playwright-best-practices` (`.agents/skills/playwright-best-practices/`) · `next-dev-loop` (`.agents/skills/next-dev-loop/`)

**Calls made in this spec** (pick, why, runner up):
- **Inline `price_data` line items**, built from the order lines; no Stripe Product catalog sync. The order is the source of truth and nothing needs keeping in step. Runner up: syncing Stripe Products and Prices, which duplicates the catalog.
- **Take what stock there is on a shortfall** (`stock - LEAST(stock, n)`), and record the missing count. Stock then matches what is really on the shelf. Runner up: skip the decrement for a short line (spec 0002's literal wording), which leaves stock claiming units that were just sold.
- **Order writes shared in `src/lib/orders/`**, because checkout (restart expiry) and orders (webhook, cron) both move orders and features may not import each other. Runner up: checkout calls into `src/features/orders/`, which breaks the layout rule.
- **Real Stripe test key in CI** (a GitHub secret) so the e2e can create a real session and assert the redirect. Runner up: the `stripe-mock` container, which drifts from real API behavior.
- **Keyset pagination** on the admin list (`?before=<number>`), stable while new orders arrive. Runner up: offset pages, which shift as orders come in.
- **A per currency minimum charge table** in pure code, plus mapping Stripe's `amount_too_small` error to the same result. Runner up: rely on Stripe's error alone, which fails only after an order row exists.
- **No Stripe receipts** (dashboard setting left off): order emails are feature 11's job and one sender avoids two different emails.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

| Path | What lives there |
|---|---|
| `src/lib/stripe.ts` | the server only Stripe client (`new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 10_000 })`, API version pinned to the one the installed SDK ships with) |
| `src/lib/orders/` | `snapshot.ts` (pure: cart lines to order lines and totals), `minimum-charge.ts` (pure), `transitions.ts` (the only functions that change `orders.status`: `markPaid`, `markExpired`, each taking a Prisma transaction), `order-image.ts` (the 0002 image rule for the snapshot) |
| `src/features/checkout/` | `actions/start-checkout.ts`, `stripe-session.ts` (pure: order to session params), `mask-email.ts` (pure), components `checkout-form.tsx`, `checkout-summary.tsx` (grows), `checkout-complete.tsx`, `complete-refresher.tsx` (client, the timed refresh) |
| `src/features/orders/` | `stripe-events.ts` (dispatch one Stripe event to a transition, pure decision in `event-decision.ts`), `webhook.ts` (request to verified event to handler), `reconcile.ts` (cron logic), `admin-queries.ts`, components `admin-orders-list.tsx`, `admin-order-detail.tsx`, `log.ts` |
| `app/(store)/checkout/complete/page.tsx` | the confirmation page |
| `app/api/stripe/webhook/route.ts` | POST, calls `features/orders/webhook.ts` |
| `app/api/cron/reconcile-orders/route.ts` | GET, calls `features/orders/reconcile.ts` |
| `app/admin/(panel)/orders/page.tsx`, `orders/[number]/page.tsx` | admin list and detail (`instant = false`, `requireAdmin()`) |
| `src/components/layout/admin-nav.ts` | adds `{ href: "/admin/orders", label: "Orders" }` |

### Data model sketch

No migration: every table exists (spec 0002). What this feature reads and writes:

| Table | Use | Fields this feature fills |
|---|---|---|
| `orders` | created `pending_payment` by `startCheckout`; moved to `paid` or `expired` by `src/lib/orders/transitions.ts` only | `number` (sequence), `email`, `cart_id`, `currency`, `subtotal_cents`, `discount_cents` 0, `shipping_cents` 0, `total_cents`, `stripe_checkout_session_id`; later `status`, `paid_at`, `stripe_payment_intent_id`, `expired_at`, `needs_attention` |
| `order_lines` (N:1 orders) | snapshot at checkout start | `variant_id`, `product_id`, `product_name`, `variant_label`, `sku`, `image_path`, `unit_price_cents`, `quantity`, `discount_cents` 0, `line_total_cents` |
| `order_events` (N:1 orders) | one row per transition or finding; `actor_type = customer` on the `created` row (the customer pressing Pay creates the order), `system` on every other row | `created`, `status_changed` (`from_status`, `to_status`, `message`), `stock_shortfall`, `note` |
| `stripe_events` | once only record, inserted in the same transaction as the change | `id` = Stripe event id, `type` |
| `product_variants` | stock taken at paid | `stock_quantity` |
| `carts`, `cart_items` | locked and read at checkout start; the cart deleted at paid | (the order's `cart_id` becomes null by `SetNull`) |

Tax, address, discount and refund columns stay null or 0 here (features 8, 10, 14; tax is deferred).

### State transitions

```
                ┌─ completed & paid / async_payment_succeeded ─▶ paid
pending_payment ┼─ completed & unpaid ─▶ (stays pending_payment, "processing")
                ├─ async_payment_failed ─▶ expired   (event: payment failed)
                ├─ session expired ─▶ expired        (event: session expired)
                └─ Pay pressed again, Stripe confirms old session expired ─▶ expired (event: replaced by a new checkout)
```

- Only `markPaid` and `markExpired` in `src/lib/orders/transitions.ts` change status, and each runs `UPDATE orders ... WHERE id = $1 AND status = 'pending_payment'`; zero rows updated means another path already moved it, so it does nothing else.
- `markPaid` is called only with a Stripe event object that was either verified by signature (webhook) or fetched from Stripe's API with the secret key (reconcile). `markExpired` is called by those same two paths, and by `startCheckout` only after Stripe confirms the old session is expired.
- A local `expired` is never set while Stripe could still take the money: on restart the session is expired at Stripe first; the cron expires locally only orders that never got a session.
- Leaving `pending_payment` for `expired` frees any discount redemption (spec 0002; none exist until feature 14).

### Event handling (webhook and reconcile share it)

`handleStripeEvent(event)` in `src/features/orders/stripe-events.ts`:

1. Open a transaction. `INSERT INTO stripe_events (id, type) ... ON CONFLICT DO NOTHING`; zero rows inserted means already processed: commit, return `duplicate`.
2. Handled types: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Any other type: commit, return `ignored`.
3. Read `order_id` from the session's `metadata`; missing, not a uuid, or no such order: commit, return `not_ours`.
4. Lock the order row (`SELECT ... FOR UPDATE`). Not `pending_payment`: commit, return `stale` (logged at info).
5. Decide (pure, `event-decision.ts`): completed and `payment_status` is `paid` or `no_payment_required`, or async succeeded → pay; completed and `unpaid` → nothing (processing); async failed → expire ("payment failed"); expired → expire ("session expired").
6. Pay: set `paid`, `paid_at = to_timestamp(event.created)`, `stripe_payment_intent_id`; for each line with a `variant_id`, in a stable order (by variant id, so two paid orders never deadlock), take stock with one statement that sees the old value under a row lock:

   ```sql
   WITH old AS (
     SELECT id, stock_quantity FROM product_variants WHERE id = $v FOR UPDATE
   )
   UPDATE product_variants p
   SET stock_quantity = p.stock_quantity - LEAST(old.stock_quantity, $n)
   FROM old WHERE p.id = old.id
   RETURNING old.stock_quantity AS before, p.stock_quantity AS after
   ```

   taken = `before - after`, missing = `$n - taken` (no row returned: the variant is gone, missing = `$n`); collect shortfalls (lines with a null `variant_id` are short by their whole quantity); compare `amount_total` and `currency`; write `status_changed`, plus `stock_shortfall` and or `note` with `needs_attention = true`; `DELETE FROM carts WHERE id = cart_id`.
7. Commit, then `revalidateTag(catalogTag, { expire: 0 })` and `revalidateTag(productTag(slug), { expire: 0 })` for each product slug on the order (read from `products` by the lines' `product_id`). A tag failure is logged at error level and does not fail the event (the data is committed); the daily reconcile run also expires `catalog` once, which bounds how long stale stock can show.

Any thrown error rolls the whole transaction back, including the `stripe_events` row, so a retry does the work again.

### API surface

All server actions return `ActionResult` (`src/lib/result.ts`) and validate input with Zod.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/checkout` | page (grows) | cookie; `?cancelled=1` | summary, email form, Pay button showing the total; the cancel notice (AC-10) | public | redirects to `/cart` (AC-2) |
| `startCheckout` | server action | `email` (string, required, max 254, trimmed and lowercased) | `{ url }` of the Stripe page; the client does `window.location.assign(url)` | public; the cart only from the signed cookie | `validation` (field error), `cart_changed` (client goes to `/cart`), `below_minimum`, `payment_processing`, `already_paid` (with the confirmation URL), `checkout_in_progress`, `payment_unavailable` (Stripe unreachable) |
| Stripe Checkout Session create (in `startCheckout`) | Stripe API | `mode: payment`, `line_items[]` (`price_data`: currency, `unit_amount`, product name with variant label, image URL when the image host is https), `customer_email`, `client_reference_id` and `metadata.order_id` = order id, `payment_intent_data.metadata.order_id`, `payment_intent_data.description` = `Order #<number>`, `expires_at` = now + 31 min, `success_url` = `<SITE>/checkout/complete?session_id={CHECKOUT_SESSION_ID}`, `cancel_url` = `<SITE>/checkout?cancelled=1`, no `payment_method_types` (dashboard methods) | session `id`, `url` | secret key | network, `amount_too_small` (→ `below_minimum`); idempotency key `checkout:<orderId>` |
| `/checkout/complete` | page | `session_id` (must match `^cs_(test\|live)_[A-Za-z0-9]+$`) | the states in AC-11 | public (knowing the session id) | unknown or malformed id → "Payment not completed" |
| `/api/stripe/webhook` | route handler, POST (Node runtime) | raw body (`await request.text()`), `Stripe-Signature` | 200 `{ received: true, result }` | Stripe signature with `STRIPE_WEBHOOK_SECRET` | 400 bad or missing signature; 500 on a processing error (Stripe retries) |
| `/api/cron/reconcile-orders` | route handler, GET | `Authorization` header | `{ checked, paid, expired, skipped, unresolved }` (`checked` = the sum of the other four) | `Bearer ${CRON_SECRET}`, constant time compare (as `expired-carts`) | 401 |
| `/admin/orders` | page | `?view=all`, `?before=<number>` | the list (AC-12) | `requireAdmin()` | 404 for non admins (proxy) |
| `/admin/orders/[number]` | page | `number` (integer ≥ 1001) | the detail (AC-13) | `requireAdmin()` | 404 for non admins; soft not found for an unknown number |

**`startCheckout` order of steps** (Stripe and the database share no rollback, so each step leaves a safe state if the next fails):
1. Validate the email. Read the cart id from the cookie (none → `cart_changed`).
2. If the cart has a `pending_payment` order with a session id, call `sessions.retrieve(id)` and branch on its stable fields, never on error text: `status = open` → `sessions.expire(id)` (if that call fails because the session just completed, retrieve again and branch once more), then `markExpired(order, "replaced by a new checkout")`; `status = expired` → `markExpired` with the same reason; `status = complete` → reload the order: `paid` (or later) → `already_paid`, still `pending_payment` (with `payment_status = unpaid`, or the webhook not yet landed) → `payment_processing`, `expired` (a delayed payment failed meanwhile) → cleared, go on to step 3 and start a new checkout. Without a session id → lock the order row and check its session id again: still none → `markExpired` directly (step 5 guarantees such an order has no live session); saved meanwhile by another tab midway through checkout → `checkout_in_progress`, the order kept. Stripe unreachable → `payment_unavailable`, nothing changed.
3. Transaction: lock the cart (`SELECT ... FOR UPDATE`), load its lines live (reuse `loadCartById` logic), refuse when `canCheckout` is false (`cart_changed`); if a `pending_payment` order for this cart exists again (another tab won the race) → `checkout_in_progress`; build the snapshot and totals; refuse below the minimum (`below_minimum`); insert the order, its lines and the `created` event. The partial unique index on `(cart_id) WHERE status = 'pending_payment'` is the backstop: a 23505 maps to `checkout_in_progress`.
4. Create the Stripe session (idempotency key `checkout:<orderId>`). On failure → `markExpired(order, "Stripe session could not be created")` and return `payment_unavailable` (or `below_minimum` for `amount_too_small`).
5. Save `stripe_checkout_session_id` on the order, then return `{ url }`. If this save fails, call `sessions.expire(session.id)` at once (the id is still in memory), then `markExpired(order, "session id could not be saved")`, and return `payment_unavailable` without redirecting. If that expire call also fails, leave the order pending: the browser never got the URL, the session dies at Stripe in 31 minutes, and the cron then finds its `checkout.session.expired` event. So a local `expired` is never set while Stripe could still take the money.

**Result shapes and copy** (the client reads these; errors render in the form's `aria-live` region or as the field error):

| Result | Client behavior | Copy |
|---|---|---|
| `{ ok: true, data: { url } }` | `window.location.assign(url)` | none (the button shows "Redirecting to payment…") |
| `validation` | field error on `email` | "Enter a valid email address." |
| `cart_changed` | `router.push("/cart")` | the cart page shows the line flags |
| `below_minimum` (with `minimumCents`) | form error | "Your total is below the minimum card payment of {amount}. Add more to your cart to pay." |
| `already_paid` (with `confirmationUrl` = `/checkout/complete?session_id=<id>`) | `window.location.assign(confirmationUrl)` | none |
| `payment_processing` | form error | "A payment for this cart is still processing. We will confirm your order once it completes." |
| `checkout_in_progress` | form error | "Checkout is already starting in another tab. Try again in a moment." |
| `payment_unavailable` | form error | "Payment is unavailable right now. Your cart is saved, please try again in a few minutes." |

**Confirmation page reads**: the order by `stripe_checkout_session_id` from the database (uncached, inside `<Suspense>`); only when the order is still `pending_payment` does it call `sessions.retrieve` to tell "confirming" from "processing" from "not completed". If Stripe cannot be reached, the page shows "confirming" (the refresher then ends on "taking longer than usual"); it only reads, so nothing is ever written from a guess. `complete-refresher.tsx` calls `router.refresh()` every 3 seconds while the state is "confirming", stops at 60 seconds, and announces the final state through an `aria-live="polite"` region. That bounds one open page to about 20 `sessions.retrieve` calls, made only while the order is pending, which is well inside Stripe's rate limits at this store's scale. `session_id` is checked with `^cs_(test|live)_\w+$` (verify against a real session id when building).

**Reconcile** (`reconcile.ts`): select up to 100 `pending_payment` orders with `created_at < now() - 90 minutes`, orders not yet flagged `needs_attention` first, then oldest first (a flagged order stays pending until a person acts, so it must not hold a batch slot ahead of newer stale orders). For each: no session id → `markExpired("no Stripe session")`. Otherwise `sessions.retrieve`: `open` or complete and `unpaid` → skip (counted in `skipped`: still live or processing). Complete and paid, or expired → list Stripe events of the four handled types created since the order (`events.list` with the `types` array and `created.gte`, auto paging, capped at 500 events; verify the `types` filter against Stripe's API reference when building, and fall back to one call per type merged by `created` if it is not available), pick the one whose `data.object.id` is this session, preferring `async_payment_succeeded`/`async_payment_failed`, then `completed`, then `expired`, and pass it to `handleStripeEvent`. None found → set `needs_attention`, write a `note` event, log an error. After the loop, `revalidateTag(catalogTag, { expire: 0 })` once. Schedule: `"30 3 * * *"` in `vercel.json`.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| `startCheckout` | cart and its lines | the cart id from the signed `bestore_cart` cookie; lines, prices, stock live from the database under the cart lock |
| `startCheckout` | `orders.email` | the form input, trimmed and lowercased by Zod |
| `startCheckout` | `orders.number` | the database sequence (starts at 1001, spec 0002) |
| `startCheckout` | `orders.currency` | `STORE_CURRENCY` |
| `startCheckout` | `order_lines.product_name`, `sku`, `unit_price_cents`, `variant_id`, `product_id` | live `products.name`, `product_variants.sku`, `product_variants.price_cents`, ids |
| `startCheckout` | `order_lines.variant_label` | `variantLabel()` in `src/lib/variant-label.ts` (option values by type position, joined with ` / `), null for a default variant |
| `startCheckout` | `order_lines.image_path` | the first image by position whose `option_value_id` is one of the variant's values, else the product's first image, else null (spec 0002) |
| `startCheckout` | `line_total_cents`, `subtotal_cents`, `total_cents` | `unit_price_cents * quantity`; sum of line totals; `subtotal - 0 + 0` |
| `startCheckout` | `shipping_cents`, `discount_cents` | 0 (features 8 and 14 fill them) |
| `startCheckout` | minimum charge | `minimumChargeCents(currency)` in `src/lib/orders/minimum-charge.ts`: a table of Stripe's published minimums for the currencies the store may use (for example EUR 50, USD 50, GBP 30, PLN 200), 50 for any other; verify the table against Stripe's docs when building |
| Stripe session | `expires_at` | now + 31 minutes (Stripe's shortest allowed is 30, measured when the request arrives, so one extra minute keeps a slow request from being refused) |
| Stripe session | `success_url`, `cancel_url` | `NEXT_PUBLIC_SITE_URL` plus the paths in the API table |
| Stripe session | line item name, amount | `product_name` + ` / ` + `variant_label` when present; `unit_price_cents` |
| Stripe session | line item image | `productImageUrl(image_path)` when that URL is https, else omitted (Stripe cannot fetch a local URL) |
| Webhook | event id, type, time | the verified event (`event.id`, `event.type`, `event.created`) |
| Webhook | order | `session.metadata.order_id` |
| Webhook | `paid_at` | `event.created` (Unix seconds, UTC) |
| Webhook | `stripe_payment_intent_id` | `session.payment_intent` |
| Webhook | amount check | `session.amount_total`, `session.currency` (lowercase; compared uppercased) against the order |
| Webhook | slugs to expire | `products.slug` for the lines' `product_id` |
| Confirmation | order state | the order row by `stripe_checkout_session_id`; Stripe `session.status` and `payment_status` only while pending |
| Confirmation | masked email | `maskEmail(order.email)`: first character, `•••`, `@` and the full domain (`k•••@gmail.com`) |
| Admin list and detail | dates | `created_at`, `paid_at` shown in `STORE_TIMEZONE` via `src/lib/dates.ts` |
| Admin list | item count | sum of `order_lines.quantity` |
| Admin detail | Stripe dashboard link | `https://dashboard.stripe.com/` + `test/` when `STRIPE_SECRET_KEY` starts with `sk_test_` or `rk_test_` + `payments/<payment intent id>` (or `checkout/sessions/<session id>` when no payment intent yet) |
| Reconcile | "older than" | `orders.created_at < now() - 90 minutes` (31 minute session plus an hour for Stripe's own retries) |

### Key invariants

- Only `markPaid` sets `paid`, and only from a Stripe event that was signature verified or fetched from Stripe with the secret key. The browser, the return URL and the confirmation page never change an order.
- Every event is applied at most once: the `stripe_events` insert and the change share one transaction; the status guard (`WHERE status = 'pending_payment'`) makes a second paid event for the same order a no op.
- Stock changes only inside `markPaid`, never goes below 0 (CHECK plus `LEAST`), and every shortfall is visible (`needs_attention` plus a `stock_shortfall` event).
- A cart has at most one `pending_payment` order (partial unique index), and a new one is created only after Stripe confirms the old session can no longer be paid.
- The Stripe session's lines and total come from the order row, and the order's from the database under the cart lock; no price ever comes from the browser.
- `sum(order_lines.line_total_cents) = subtotal_cents - discount_cents` (tested in `snapshot.test.ts`).

### Security model

- **Compliance**: PCI DSS scope stays SAQ A (card data only ever on Stripe's hosted page). GDPR applies to the email (spec 0002).
- The webhook trusts nothing it has not verified: signature check with `STRIPE_WEBHOOK_SECRET` on the raw body before any parsing; the order is found from Stripe's own metadata, never from a query parameter.
- `startCheckout` is public but acts only on the cart named by the verified cookie, and one pending order per cart bounds how many Stripe sessions a visitor can create. A Vercel Firewall rate limit on `POST /checkout` is added to feature 19.
- The confirmation page shows an order only to someone holding its Stripe session id (long, random, from Stripe's redirect), masks the email, and sends `noindex` and `no-referrer` so the id never leaks through a Referer header.
- Admin pages call `requireAdmin()`; the proxy already gives non admins a real 404 on `/admin/*`.
- Logs carry order ids, numbers, event ids and amounts only; never emails, names or card data.
- Audit: every status change and shortfall is an `order_events` row with `actor_type = system` (the `created` row is `customer`).

### Observability

Via `src/lib/logger.ts` (pino), one event name per line:

| Event | Level | Fields |
|---|---|---|
| `checkout.started` | info | `orderId`, `number`, `totalCents` |
| `checkout.refused` | info | `reason` (the error code) |
| `checkout.stripe_failed` | error | `orderId`, Stripe error `code` |
| `stripe.webhook.invalid_signature` | warn | none (never the header) |
| `stripe.event.processed` | info | `eventId`, `type`, `result` (`paid`, `expired`, `processing`, `duplicate`, `ignored`, `not_ours`, `stale`) |
| `stripe.event.failed` | error | `eventId`, `type`, error message |
| `order.paid` | info | `orderId`, `number`, `totalCents` |
| `order.expired` | info | `orderId`, `reason` |
| `order.stock_shortfall` | error | `orderId`, `skus` with missing counts |
| `order.amount_mismatch` | error | `orderId`, expected and received amounts and currencies |
| `cron.reconcile_orders` | info | counts; `error` level when `unresolved > 0` |
| `order.reconcile_unresolved` | error | `orderId`, session status |
| `cron.reconcile_stripe_failed` | error | `orderId`, error message (Stripe unreachable, order skipped) |
| `cron.reconcile_order_failed` | error | `orderId`, error message (any other failure, order skipped) |
| `cache.tag_expiry_failed` | error | error message |

Error level lines are what feature 18 turns into alerts.

### Configuration required

- `STRIPE_SECRET_KEY`: server key; Zod `^(sk|rk)_(test|live)_`. Test key locally, in CI (GitHub secret) and on staging; live key only in production.
- `STRIPE_WEBHOOK_SECRET`: webhook signing secret; Zod `^whsec_`. Locally the one `stripe listen` prints; in CI a fixed test value used to sign generated events; per Vercel environment its own endpoint secret (spec 0001).
- Both join `src/lib/env.ts` (remove the "join later" comment line for feature 7), `.env.example` (already listed), and `tests/valid-env.ts`.
- **Prerequisites before coding**: a Stripe account in test mode; the payment methods you want switched on in the dashboard (they must support `STORE_CURRENCY`); Stripe CLI installed locally (`stripe listen --forward-to localhost:3000/api/stripe/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired`); Stripe receipts left off.
- New dependency: `stripe` (the official Node SDK).
- `vercel.json`: add `{ "path": "/api/cron/reconcile-orders", "schedule": "30 3 * * *" }` (and extend `vercel.test.ts`).

### Critical test scenarios

Pure logic in `*.test.ts` beside the source; database paths in `tests/db/*.db.test.ts` against the real test database, with events built as real Stripe event JSON and signed by `stripe.webhooks.generateTestHeaderString` and the CI webhook secret; Stripe API calls in db tests are stubbed at the `src/lib/stripe.ts` boundary.

- Happy path: a clean cart, `startCheckout` creates one pending order whose lines and totals match the cart and a session request whose lines and total match the order; a signed `completed`/`paid` event posted to the route makes it `paid`, takes stock, deletes the cart, writes one event, verifies **AC-1**, **AC-4**
- Idempotency: the same signed event posted twice, then `async_payment_succeeded` for the same order; one transition, stock taken once, verifies **AC-5**
- Delayed and failed: `completed`/`unpaid` then `async_payment_failed`; order `expired`, stock untouched; `checkout.session.expired` likewise, verifies **AC-6**
- Shortfall and mismatch: stock 2, line 3 → stock 0, `needs_attention`, one `stock_shortfall` naming the SKU and 1 missing; an `amount_total` off by one cent → paid, flagged, `note` written, verifies **AC-7**, **AC-8**
- Concurrency: two paid orders racing for the last unit end with stock 0 and exactly one shortfall; two `startCheckout` calls for one cart at once end with one pending order, verifies **AC-7**, **AC-9**
- Restart: pending order exists, stub `expire` succeeds → old order `expired`, new one created; stub reports complete and the order paid → `already_paid`, nothing created, verifies **AC-9**
- Refusals: bad email, flagged line, below minimum, Stripe create failure (order ends `expired`, `payment_unavailable`), verifies **AC-2**
- Webhook guards: no signature and a wrong signature → 400 and no rows; a foreign session, an unhandled type and a stale order → 200 and recorded; a handler that throws → 500 and no `stripe_events` row, verifies **AC-3**, **AC-16**
- Reconcile: no bearer → 401; a stale order whose paid event is returned by the stubbed `events.list` ends paid once, even if run twice; one with no session ends expired; one with no findable event is flagged, verifies **AC-15**
- Tags: after a paid event, `revalidateTag` was called for `catalog` and the product slug (mocked `next/cache`), verifies **AC-4**
- Confirmation states: each state in AC-11 renders from a seeded order and a stubbed session; the page never writes, verifies **AC-11**
- Admin: list default view hides pending and expired, toggle shows them, keyset paging; detail shows lines, ids and the attention banner; a signed out visitor and a non admin get 404, verifies **AC-12**, **AC-13**, **AC-14**
- e2e (CI, real Stripe test key): add to cart, enter email, Pay → the browser lands on `checkout.stripe.com`; cancel URL → notice shown, cart intact; keyboard only run and axe on `/checkout`, `/checkout/complete`, `/admin/orders`, detail, verifies **AC-1**, **AC-10**, **AC-18**
- e2e local only (`@stripe` tag, needs `stripe listen`): pay with test card `4242 4242 4242 4242` → confirmation shows the paid order; the admin list shows it; the product's stock dropped; a declined card leaves no paid order, verifies **AC-4**, **AC-6**, **AC-11**, **AC-12**
- Env and logs: env schema rejects malformed Stripe keys; log lines carry no email (assert on captured pino output), verifies **AC-17**, **AC-19**

## Build plan

Tracer Bullet: Milestone 1 pushes one real payment through every layer (form, action, order row, Stripe, webhook, stock, admin list) for the happy path only; each later milestone thickens one segment and ships with its tests. No migration in any milestone.

**Milestone 1: thin thread, one paid order end to end**
1. [x] Add `stripe`; `src/lib/stripe.ts`; `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `src/lib/env.ts` and `tests/valid-env.ts`; add the Stripe test key and a fixed webhook secret to CI, satisfies **AC-19**
2. [x] `src/lib/orders/snapshot.ts` (with `order-image.ts`) and its unit tests; `startCheckout` steps 1, 3, 4, 5 (no restart handling yet) with `markExpired` for a failed session create; the email form and Pay button on `/checkout` replacing the notice, satisfies **AC-1**
3. [x] `src/lib/orders/transitions.ts` `markPaid`; `handleStripeEvent` for `completed`/`paid` with the `stripe_events` insert, stock decrement, cart delete and tag expiry; `app/api/stripe/webhook/route.ts` with signature check, satisfies **AC-3**, **AC-4**
4. [x] Minimal `/checkout/complete` (paid state and "confirming" with refresh); minimal `/admin/orders` list (paid only, no paging) with the nav entry, satisfies **AC-11**, **AC-12**, **AC-14**
5. [x] db tests for the happy path and bad signatures; e2e to the Stripe redirect in CI; the local `@stripe` spec for one paid order, satisfies **AC-1**, **AC-3**, **AC-4**

**Milestone 2: every webhook path, once and only once**
6. [x] `event-decision.ts` (pure) covering all four types and payment statuses; `markExpired` from events; duplicate, foreign, unhandled and stale events; throw → 500 with rollback, satisfies **AC-5**, **AC-6**, **AC-16**
7. [x] Shortfall with `LEAST`, stable lock order, `needs_attention` and `stock_shortfall`; amount and currency check with `note`, satisfies **AC-7**, **AC-8**
8. [x] db tests: idempotency, delayed then failed, expired, shortfall, mismatch, the two order stock race, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-8**

**Milestone 3: checkout guards and paying twice**
9. [x] `startCheckout` step 2 (restart: expire at Stripe, `already_paid`, `payment_processing`), `checkout_in_progress` with the 23505 backstop; `minimum-charge.ts` and `amount_too_small` mapping; field and form errors in the form; the `?cancelled=1` notice, satisfies **AC-2**, **AC-9**, **AC-10**
10. [x] db tests for restart, concurrent submits, refusals and Stripe failure; e2e for the cancel return, satisfies **AC-2**, **AC-9**, **AC-10**

**Milestone 4: customer and admin views complete**
11. [x] Confirmation page: all AC-11 states, `maskEmail`, 60 second cap, `aria-live`, `noindex` and `no-referrer`, satisfies **AC-11**
12. [x] Admin list: default and "All orders" views, keyset paging (50), dates in `STORE_TIMEZONE`, item count, badge, empty state; admin detail page with lines, totals, Stripe links, event history and the attention banner, satisfies **AC-12**, **AC-13**, **AC-14**
13. [x] Tests for page states, paging and the admin 404s, satisfies **AC-11**, **AC-12**, **AC-13**, **AC-14**

**Milestone 5: safety net, logs and accessibility**
14. [x] `reconcile.ts` and `app/api/cron/reconcile-orders/route.ts` with the cron guard; `vercel.json` entry and `vercel.test.ts`; db tests with a stubbed Stripe, satisfies **AC-15**
15. [x] Every log line in *Observability* (`src/features/orders/log.ts`, checkout logs) and a test that no email appears, satisfies **AC-17**
16. [x] Keyboard and axe passes on the four pages; the local `@stripe` spec extended with a declined card and the stock check, satisfies **AC-18**, **AC-6**

## Consequences

**Positive**:
- One code path decides "paid", and it is idempotent at the database level, so Stripe's retries, the reconcile replay and a double click can never pay or take stock twice.
- The order snapshot is taken before payment, so the customer pays exactly the prices they saw, and later features (shipping, discounts, emails, refunds) attach to an order row that already exists.
- No schema change; everything rides on spec 0002's constraints.
- Dashboard payment methods let you add local methods later without code.

**Negative / tradeoffs**:
- Stock is not held during payment, so two customers can pay for the last unit; the second order is flagged and you refund it by hand in the Stripe dashboard until feature 10.
- Delayed methods leave orders `pending_payment` for hours or days; the cart can be edited meanwhile, and the cart is deleted when the payment finally succeeds, which drops anything added after checkout started.
- Every Pay press after the first costs a Stripe API call to expire the old session, and the confirmation page calls Stripe while an order is pending.
- The reconcile cron is extra code that only matters on a bad day, and it widens "only the webhook marks paid" to "only a verified Stripe event marks paid" (AGENTS.md wording should follow).
- If `revalidateTag` fails after a sale, product pages can show the old stock until the next catalog write or the next daily reconcile run; add to cart and checkout still recheck stock, so nobody can buy what is not there.
- CI now needs a real Stripe test key and reaches Stripe on every run; a Stripe outage can fail the e2e job.
- Audit logging is not optional here: every status change and shortfall writes an `order_events` row.

**Neutral**:
- Customers get no email yet (feature 11); the confirmation page and the order number are all they have.
- `needs_attention` is set here but only cleared in feature 10.
- Payment flows are fully tested only locally or on staging (per spec 0001, preview URLs get no webhooks).

## Follow-up

- [ ] Root `AGENTS.md` Security rule: reword "Only the Stripe webhook marks an order paid" to "Only a verified Stripe event (the webhook, or the reconcile cron replaying one fetched from Stripe) marks an order paid" (for `/sync`).
- [ ] Feature 19: add a Vercel Firewall rate limit on `POST /checkout`, register the production and staging webhook endpoints for the four event types, and set the live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- [ ] Feature 10: clearing `needs_attention`, refunds for shortfall orders, and `charge.refunded` / dispute events.
- [ ] Feature 11: the order confirmation email hangs off `markPaid` (after commit), keyed `order_confirmation:<orderId>`.
- [ ] Feature 18: alert on the `error` level events in *Observability*.
- [ ] Consider installing Stripe's official agent skill (from `stripe/ai`) for Stripe API and webhook conventions; this would improve implementation guidance for this feature. The Stripe MCP server is already connected.
- [ ] Payment conventions (webhook, transitions, reconcile) belong in a nested `src/features/orders/AGENTS.md` once built (for `/sync`).
