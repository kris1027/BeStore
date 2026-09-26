# Cart

## Overview

The guest cart: add to cart, `/cart` with quantity and remove, the header count, and the daily expired cart cron. The cookie and the read side live in `src/lib/cart/` because the checkout feature reads the cart too. Governing spec: [0005 Core buy loop](../../../docs/specs/0005-core-buy-loop/index.md).

## Files

- `actions.ts`: `addToCart`, `setCartItemQuantity`, `removeCartItem`.
- `expired-carts.ts`: the logic behind `GET /api/cron/expired-carts` (scheduled in `vercel.json`).
- `src/lib/cart/signature.ts`, `cookie.ts`: the `bestore_cart` cookie, `<cartId>.<HMAC SHA 256>` signed with `CART_COOKIE_SECRET`.
- `src/lib/cart/load-cart.ts`: loads the cart with live variant data; `cart-lines.ts`: pure line flags, totals and `canCheckout`.

## Conventions

- Actions take only a variant id or line id and a quantity, never a price; prices always come from the database.
- A bad signature, an unknown cart or an expired cart reads as no cart, never an error page; the next add creates a new cart and replaces the cookie.
- Only server actions set the cookie. Every cart write renews the cookie and `carts.expires_at` together (30 days).
- Writes lock the cart row (`SELECT ... FOR UPDATE`) so concurrent adds cannot pass a line's cap: the variant's stock or 10 (`lineCap` in `src/lib/availability.ts`).
- A line action only touches lines of the cart named by the verified cookie; a line id from another cart answers `not_found`.
- Rendering a cart never writes. Line flags ("No longer available", "Sold out", "Only N left") are computed at read time, never stored.
- The cron deletes in batches of 1000 until a batch deletes nothing; lines cascade, orders keep their row with `cart_id` null.
- Logs: `cart.cookie.invalid` (warn, never the cookie value) and `cron.expired_carts` (count only).

## Tests

Pure rules have `*.test.ts` beside them; actions, `loadCart` and the cron run against a real database in `tests/db/` (`pnpm test:db`); flows in `tests/e2e/catalog/cart.spec.ts`.

_Drafted by /sync from the introducing change, worth a quick human pass._
