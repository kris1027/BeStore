# Review, feat/shipping-address-flat-rate, 2026-09-30

**Reviewed by**: Sonnet 5.5 (author on Opus)
**Scope**: 50 files, branch vs main
**Verdict**: Approve with nits

## Summary
Adds the delivery address form, a single pure flat-rate/free-threshold rule, a shipping snapshot on the order, Stripe shipping option plus payment intent shipping, an admin settings page, and address display on admin and confirmation pages. The implementation follows spec 0007 closely: the fee is read uncached inside the order transaction, the rule lives in one module, the tag is expired with `updateTag`, `requireAdmin()` is called in both the page and the action, and logs carry no PII. Only small validation and robustness gaps were found; no blockers or majors.

## Minor
### 🟡 Phone length is unbounded, `src/lib/shipping/address.ts:52`
**Problem**: `isPhone` limits digits to 7 to 15 but the pattern allows unlimited spaces, parentheses and hyphens, and there is no `.max()`. A crafted `startCheckout` call can store and forward to Stripe a multi-kilobyte "phone".
**Why it matters**: Oversized value written to `orders.phone`, rendered in admin, and sent to Stripe (which may reject it and surface as `payment_unavailable`). Every other text field has a cap.
**Suggested fix**: Cap the trimmed phone length (e.g. 30) with the existing phone message, and test it.

### 🟡 Non-string or missing fields give a generic Zod message, `src/lib/shipping/address.ts:59`, `:80`
**Problem**: `required()` and `postalCode` start from `z.string()`, so a crafted call that omits `city` or sends a number returns Zod's default "Invalid input: expected string" instead of the spec's per-field message. Same for settings `deliveryFee` in `src/features/settings/schemas.ts:42`.
**Why it matters**: Spec says a crafted call with a missing city is refused with the same fields and messages. It is refused, but the message text differs from the table; it is also an English Zod string that could change with Zod versions.
**Suggested fix**: Pass an `error`/`message` option on the base `z.string()` (or preprocess undefined to "") so the empty message is used.

### 🟡 Spec status still "In Progress", `docs/specs/0007-shipping-address-flat-rate/index.md:4`
**Problem**: All ten build-plan tasks are checked but status is unchanged.
**Why it matters**: Minor doc drift; `/sync` or the merge step should flip it.
**Suggested fix**: Update status when the verify pass is done.

## Nits
- ⚪ `src/features/cart/components/cart-contents.tsx:127`, the "Add X more for free delivery" copy has no trailing period, unlike other messages; fine if intentional.
- ⚪ `src/features/checkout/components/checkout-form.tsx:185`, country is a `dl` with a single pair inside a form; a plain labelled text block is enough, `dl` is harmless.
- ⚪ `src/lib/shipping/address.ts:24`, `text.replace("-", "")` only removes the first hyphen; safe because the pattern allows one, a comment would save a future reader the check.

## Strengths
- The AC-3 rule is one pure function used by cart, checkout summary, snapshot, Stripe labels and admin labels; settings are read in the order transaction (AC-5, AC-7) and display uses a tagged `'use cache'` read expired by `updateTag`.
- Idempotent schema transforms, shared client and server schema, and field-map validation errors; logs deliberately carry only field names (AC-14).
- Settings save reads the old row `FOR UPDATE` in the same transaction so the log "from" is accurate; `requireAdmin()` is in both the page and the action.

## Test coverage
Strong: unit tests for the rule, address schema, settings schema, money, snapshot, env and Stripe params; DB tests for prefill ordering, settings reads, the settings action (including non-admin and bad input), admin and confirmation pages, and fee frozen on the order; Playwright for validation and focus, keyboard use, prefill, paid-order address, legacy orders, settings change and the Pay-time fee race, plus auth gate. Gaps: no test for an oversized phone (because it is not limited) or for crafted non-string input messages.
