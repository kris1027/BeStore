# Shipping

## Overview

The delivery rules every feature shares: the address schema, the flat fee rule, and the settings reads. Checkout, the cart, settings and the admin order pages all import from here, so they can never disagree on an address or a fee. Governing spec: [0007 Shipping address and flat rate](../../../docs/specs/0007-shipping-address-flat-rate/index.md).

## Files

- `rule.ts`: pure. `shippingCents` (the one fee rule), `orderCharges` (fee plus total), `freeDeliveryGapCents` (the cart nudge), `deliveryLabel`.
- `address.ts`: pure. `storeCountries` and the per country postal rule, `shippingAddressSchema(country)` with its messages, `ShipTo` and `deliveryColumns` (address to order columns), `deliveryAddressColumns` and `withDeliveryAddress` (order columns to a display address), `countryDisplayName`.
- `settings.ts`: `import "server-only"`. `getShippingSettings()` is `'use cache'` tagged `storeSettingsTag`, for display. `readShippingSettings(client = db)` is the live row, for Pay (inside its order transaction) and the admin form.
- `src/components/delivery-row.tsx`, `src/components/delivery-address.tsx`: the delivery summary row and the address block built on these helpers.

## Conventions

- Compute a fee or a total only through `orderCharges` / `shippingCents`. `total = subtotal - discount + shipping` is also a database CHECK on `orders`.
- Pay reads the settings with `readShippingSettings(tx)` inside the transaction that locks the cart, never from the cache and never from the browser.
- Every schema transform is safe to run twice: the checkout form sends its parsed output, and the server parses it again.
- `STORE_COUNTRY` accepts only `storeCountries`. A new country needs a postal rule in `address.ts` first, or the app refuses to boot.
- Name, address lines, postal code and phone are personal data: never log them.

## Tests

`*.test.ts` beside each pure module. `settings.ts` runs against a real database in `tests/db/shipping.db.test.ts` (`pnpm test:db`).

_Drafted by /sync from the introducing change, worth a quick human pass._
