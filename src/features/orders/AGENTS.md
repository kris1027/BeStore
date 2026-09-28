# Orders

## Overview

Everything after the customer presses Pay: the signed Stripe webhook that marks an order paid, the daily reconcile cron that replays lost Stripe events, and the admin order list and order page. The checkout side (the email form, `startCheckout`, `/checkout/complete`) lives in `src/features/checkout/`. Order writes that both features need live in `src/lib/orders/`. Governing spec: [0006 Card payment and paid orders](../../../docs/specs/0006-card-payment-paid-orders/index.md).

## Files

- `webhook.ts`: `POST /api/stripe/webhook`. Verifies the `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET` (400 otherwise), then calls `handleStripeEvent`.
- `stripe-events.ts`: `handleStripeEvent`, the one path from a Stripe event to an order change, shared by the webhook and the cron. Also `expireCatalogTags`.
- `event-decision.ts`: pure. The four handled `checkout.session.*` types and what each one decides.
- `reconcile.ts`: `GET /api/cron/reconcile-orders` (daily in `vercel.json`). Replays the decisive Stripe event for pending orders older than 90 minutes.
- `admin-queries.ts`, `components/`: `/admin/orders` (keyset paging with `?before=<number>`, `?view=all` adds pending and expired) and `/admin/orders/[number]`.
- `src/lib/orders/transitions.ts`: `markPaid` and `markExpired`, the only code that changes `orders.status`.
- `src/lib/orders/snapshot.ts`, `order-image.ts`, `minimum-charge.ts`: pure order line snapshot, line image pick, per currency Stripe minimum.
- `src/lib/stripe.ts`: the Stripe client (pinned `STRIPE_API_VERSION`) and `stripeDashboardUrl`. `src/lib/cron-auth.ts`: `isCronRequest`, the constant time Bearer check every cron uses.

## Conventions

- Only `handleStripeEvent` marks an order paid. The cron never decides paid itself; it fetches the real event from Stripe and replays it through the same handler. Expiry without an event (a checkout restart, an order with no session) still goes through `markExpired`.
- The `stripe_events` insert (`ON CONFLICT DO NOTHING`) and the order change share one transaction. A replay finds its row and does nothing, and a thrown error rolls both back so Stripe's retry does the work again (the route answers 500).
- Every write that changes an order must be guarded by `status = 'pending_payment'`. Zero rows updated means another path already settled it, so do nothing else. That includes side writes like the reconcile flag.
- The order is found from the session's `metadata.order_id`, never from anything the browser sent. Foreign, unhandled and stale events answer 200 and change nothing.
- Stock is taken on paid with a locked `LEAST` update, so it never goes below 0. A shortfall or an amount or currency mismatch still marks the order paid, sets `needs_attention` and writes an event explaining why.
- After a paid commit, expire `catalog` and each affected `product:<slug>` tag with `revalidateTag(tag, { expire: 0 })` (route handler context).
- Both admin pages call `requireAdmin()`. Dates show in `STORE_TIMEZONE`.
- Logs carry order ids, numbers and amounts, never an email or a card detail: `order.paid`, `order.expired`, `order.stock_shortfall`, `order.amount_mismatch`, `stripe.event.processed`, `stripe.event.failed`, `stripe.webhook.invalid_signature`, `cron.reconcile_orders`, `order.reconcile_unresolved`, `cron.reconcile_stripe_failed`, `cron.reconcile_order_failed`, `cache.tag_expiry_failed`.

## Tests

Pure logic has `*.test.ts` beside it. The webhook, reconcile and admin queries run against a real database in `tests/db/` (`pnpm test:db`), with events signed the way Stripe signs them (`tests/db/stripe-support.ts`). Flows are in `tests/e2e/checkout/`. The hosted page test needs `STRIPE_E2E=1` and `stripe listen` running.

_Drafted by /sync from the introducing change, worth a quick human pass._
