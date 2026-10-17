# Discounts

## Overview

Admin promo codes under `/admin/discounts`: the list (uses, discount given, status, search), create, edit and delete. Applying a code at checkout lives in `src/features/checkout/` (`applyDiscountCode`, the code in `startCheckout`); the rule and the code reads both features need live in `src/lib/discounts/`. Governing spec: [0014 Discounts and promo codes](../../../docs/specs/0014-discounts-promo-codes/index.md).

## Files

- `app/admin/(panel)/discounts/page.tsx`, `new/page.tsx`, `[id]/page.tsx`: thin routes.
- `actions/`: `create-discount-code.ts`, `update-discount-code.ts`, `delete-discount-code.ts`.
- `admin-queries.ts`: `getDiscountCodes` (newest first, at most `DISCOUNT_LIST_LIMIT` = 200, uses and discount given from grouped subqueries, status derived in SQL) and `getDiscountCodeForEdit`.
- `schemas.ts`, `list-params.ts`, `paths.ts`, `log.ts`: pure form schema, the `q` and `status` list params, every admin URL (`discountOrdersPath` links to `/admin/orders?discount=<id>`), and `discount.*` events.
- `components/`: list, status filter, form, editor, delete button, code labels.
- `src/lib/discounts/rule.ts`: pure. The discount amount and its caps (`cappedDiscount`), the refusal order (`refusal`, `evaluateDiscount`), the line split (`splitDiscount`), `codeStatus`, labels and messages. The only place the money math lives.
- `src/lib/discounts/schema.ts`: pure. Code text parsing (trim, uppercase, `^[A-Z0-9-]{3,32}$`) and `normalizeEmail`, which the checkout email schema also uses.
- `src/lib/discounts/codes.ts`: server only. `findCode`, `lockCode`, `countRedemptions`, `redeem`, `previewDiscount`, and `orderHoldsUse` (`PENDING_HOLD_MINUTES` = 35).

## Conventions

- Every page and action calls `requireAdmin()` itself.
- A use counts when its order was ever paid or is `pending_payment` and younger than 35 minutes. Count uses only through `orderHoldsUse` / `countRedemptions`, so the list, Apply and Pay agree.
- Every write that depends on uses (edit, delete, a checkout redeeming) takes `lockCode` (`FOR UPDATE`) first. In checkout the order is customer lock, cart lock, then code lock.
- Code, type and value never change once a redemption exists (`locked_fields`); a code with a redemption cannot be deleted (`used`). Edits check the form's `updatedAt` (`stale`).
- Status is derived, never stored: Inactive, Used up, Expired, Scheduled, Active, the first that applies. The SQL filter uses the database clock and must match `codeStatus`.
- Orders keep a snapshot of the code text, type and value. Filter orders by code id, never by text, because a deleted code's text can be reused.
- `markExpired` and `markCancelled` (pending path) in `src/lib/orders/transitions.ts` delete the order's redemption, which frees the use. A paid order keeps it.
- Dates in the form are `datetime-local` in `STORE_TIMEZONE`, converted with `zonedDateTimeToUtc` / `utcToZonedInput` (`src/lib/dates.ts`).
- Logs carry the admin id, `discountCodeId` and changed field names only, never the code text, the note or an email. Use `discountCodeId`, not `code`, because the logger redacts `code`.

## Tests

Pure rules have `*.test.ts` beside them (`src/lib/discounts/`, `schemas.test.ts`, `list-params.test.ts`). Admin actions and queries run in `tests/db/discounts-admin.db.test.ts`, checkout with a code in `tests/db/discounts-checkout.db.test.ts` (`pnpm test:db`). Flows are in `tests/e2e/admin/discounts.spec.ts` and `tests/e2e/checkout/discounts.spec.ts`.

_Drafted by /sync from the introducing change, worth a quick human pass._
