# Settings

## Overview

`/admin/settings`, the store wide settings page. Today it has one Shipping section: the flat delivery fee and the optional free delivery threshold, both stored on the single `store_settings` row (`id = 1`). Later store wide settings join the page as more sections. Governing spec: [0007 Shipping address and flat rate](../../../docs/specs/0007-shipping-address-flat-rate/index.md) (AC-10, AC-14).

## Files

- `app/admin/(panel)/settings/page.tsx`: thin route. It calls `requireAdmin()` and renders `SettingsPage`.
- `admin-queries.ts`: `getAdminShippingSettings()` reads the live row (never cached) and turns cents into form strings with `centsToInput`.
- `schemas.ts`: pure. `shippingSettingsSchema(currency)` is shared by the form (zodResolver) and the action. `shippingSettingsFields` is the one list of error fields, used by `shippingSettingsFieldErrors` and the form.
- `actions/update-shipping-settings.ts`: `updateShippingSettings`, which returns `ActionResult` with a `validation` field map.
- `components/`: `SettingsPage` and `ShippingSettingsForm`.
- `log.ts`: `settings.shipping_updated`.

## Conventions

- The action calls `requireAdmin()` first, then reads the old row `FOR UPDATE` and writes the new one in the same transaction, so the log's `from` is the value this save really replaced. Last write wins.
- Call `updateTag(storeSettingsTag)` only after the commit. The cart and checkout read the settings through the cached `getShippingSettings()`, while Pay reads the live row inside its order transaction.
- Money is typed like the catalog price field: `parseMoney`, a dot as the decimal mark, bounds checked in cents from the currency's own fraction digits. Unchecking free delivery stores `null` and ignores whatever the threshold field holds.
- A missing or wrong typed value (only a crafted request can send one) still gets its field's message. Never return an empty `fields` map.
- The missing settings row is a broken invariant (the migration inserts it), so it throws instead of returning an error.

## Tests

`schemas.test.ts` beside the schema. The reads and the action (saving, the logged `from`, the tag expiry, refusals, non admin calls) run against a real database in `tests/db/shipping.db.test.ts` (`pnpm test:db`). The flow and axe checks are in `tests/e2e/admin/settings.spec.ts`.

_Drafted by /sync from the introducing change, worth a quick human pass._
