# Checkout

## Overview

Everything from `/checkout` to the order confirmation. The customer types their email and delivery address, `startCheckout` freezes the cart into a pending order and sends the browser to Stripe's hosted page, and `/checkout/complete` shows the result. Marking an order paid is not done here: the Stripe webhook in `src/features/orders/` does that.

## Key files

| File | Owns |
|---|---|
| `app/(store)/checkout/page.tsx`, `complete/page.tsx` | Thin routes. Both wrap the feature component in Suspense and are `noindex`. |
| `actions/start-checkout.ts` | `startCheckout`: validate, clear any earlier pending order, create the order under the cart lock, create the Stripe session, save its id. |
| `schemas.ts` | Pure. `checkoutSchema(country)` = email plus `shippingAddressSchema`, `checkoutFields`, `checkoutFieldErrors`, `sessionIdSchema`. |
| `stripe-session.ts` | Pure. `checkoutSessionParams`, the order turned into Checkout Session params (inline `price_data`, one fixed `shipping_rate_data`). |
| `queries.ts` | `checkoutPrefill(cartId)` for a return visit and `getCompletion(sessionId)` for the confirmation page. |
| `components/checkout-form.tsx` | The client form (React Hook Form plus zodResolver), mapping each `StartCheckoutError` code to a message, a field error or a redirect. |
| `components/checkout-summary.tsx`, `checkout-complete.tsx`, `complete-refresher.tsx` | The order summary with the Pay total, the confirmation page, and the refresh every 3 seconds while the webhook is on its way. |
| `log.ts`, `mask-email.ts` | `checkout.*` log events; the `k•••@gmail.com` email mask. |

## Conventions

- `startCheckout` takes only what the customer typed. The cart comes from the signed cookie, and prices and the delivery fee come from the database inside the transaction that locks the cart (`SELECT ... FOR UPDATE`), never from the browser or the cache.
- Expected failures are `StartCheckoutError` codes. A validation refusal returns a `fields` map with the same messages the form shows, and the form focuses the first invalid field. Every field missing or of the wrong type still gets its own message.
- Every schema transform must be safe to run twice: `handleSubmit` sends the parsed output and the server parses it again.
- The address travels as one `ShipTo` value, saved with `deliveryColumns` and sent to Stripe as `payment_intent_data.shipping`. Empty optional keys are left out, never sent as `""`.
- `getCompletion` is read only. It asks Stripe through `sessionState` only while the order is still pending, and it never changes an order.
- Logs carry order ids, numbers, amounts and field names only, never an email, name, address, postal code, phone or a Zod error. Use the key `stripeCode`, not `code`, because the logger redacts `code`.

## Gotchas

- Stripe and the database share no rollback. Each step leaves a safe state if the next one fails, and an order is set expired only once Stripe can no longer take money for it (the session was never created, was killed, or Stripe says it expired).
- A cart holds at most one pending order (`orders_one_pending_per_cart_key`). Before a new one, the old session is expired at Stripe; if Stripe says it is paid, processing or unknown, the old order is kept and the customer gets `already_paid` / `payment_processing`.
- Two tabs can race. The session id is saved only while the order is still pending (`saveSessionId` answers `moved` otherwise), and an order with no session id is rechecked under its row lock before it is expired.
- Session creation uses the idempotency key `checkout:<orderId>`, so a retried create returns the same session instead of a second one.
- The Pay button stays disabled until hydration, so a native submit can never put the email in a GET query. A `pageshow` listener resets "Redirecting" when the back button restores the page from the back/forward cache.
- The session id in the confirmation URL is the key to the order. The page sends `no-referrer` (also set in `next.config.ts`) and is never indexed.

## Commands

- `pnpm test:db tests/db/start-checkout.db.test.ts` runs the action against a real database (needs `pnpm db:start`).
- The Stripe hosted page e2e is skipped by default. To run it: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, then `STRIPE_E2E=1 pnpm test:e2e --grep @stripe --project desktop`.

## Related specs

- [0006 Card payment and paid orders](../../../docs/specs/0006-card-payment-paid-orders/index.md)
- [0007 Shipping address and flat rate](../../../docs/specs/0007-shipping-address-flat-rate/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
