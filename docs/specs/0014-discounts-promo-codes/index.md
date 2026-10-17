# 0014. Discounts and promo codes

**Date**: 2026-10-17
**Status**: Accepted

## Summary

Admins create promo codes (a percent or a fixed amount off the items, with optional dates, use limits and a minimum spend) on new `/admin/discounts` pages, and customers type one code on `/checkout`. Apply shows the new total right away, and Pay checks the code again under a database lock, saves the discount on the order and its lines, and holds one use of the code until the order is paid or expires. Stripe's hosted page shows the same discount through a one off coupon (a Stripe discount object) we create per order with our exact amount, so the amount Stripe charges always equals our total. The tables already exist from spec 0002; one small migration adds a note, who created or edited a code, a format check and an index.

## Requirements

**User stories**:
- As a customer, I want to type a promo code at checkout and see my new total before I pay, so I know the code worked and what I will be charged.
- As a customer, I want a clear reason when a code does not work, so I can fix it (spend more, try another code) or move on.
- As an admin, I want to create, edit, deactivate and delete promo codes with dates and limits, so I can run promotions without a deploy.
- As an admin, I want to see how often each code was used, how much discount it gave, and which orders used it, so I can judge a promotion.
- As an admin, I want each order and refund to show the code and the discount it got, so support and refunds use the right amounts.

**Acceptance criteria**:
- **AC-1**: The `/checkout` order summary shows a "Promo code" field (visible label) with an Apply button above the totals. The typed text is trimmed and uppercased. Pressing Enter in the field runs Apply, never Pay. On success the summary shows a "Discount (CODE)" row with the amount as a negative price, recomputes the delivery row and the total (delivery uses `subtotal - discount`, spec 0007 AC-3, so a code can take an order back under the free delivery threshold), shows a Remove button in place of Apply, and the Pay button total matches. Remove drops back to the totals without a code. The result is announced in a polite live region; a refusal shows its message under the field (linked with `aria-describedby`) and focus stays on the field.
- **AC-2**: The discount is worked out on the items subtotal only, at the prices the customer pays (sale prices included); delivery is never discounted. Percent: `round_half_up(subtotal * value / 100)`, in integer math. Fixed amount: `value`. Then, with `S` the subtotal, `fee(x)` the spec 0007 delivery for an items amount `x`, `T` the free delivery threshold (when set) and `M` = `minimumChargeCents(STORE_CURRENCY)`:
  1. `d = min(raw, S)`.
  2. Never cost more than no code: when `T` is set, `S >= T` and `S - d < T`, also try `d2 = S - T` (keeps delivery free) and keep whichever of `d` and `d2` gives the lower `S - x + fee(S - x)`; on a tie keep the larger.
  3. Minimum charge: when `S - d + fee(S - d) < M`, lower `d` to the largest value with `S - d + fee(S - d) >= M`, computed as `S + fee(S - d) - M` and, if that changes `fee`, recomputed once with the new fee (two steps at most, since `fee` only takes two values).

  The summary and the order show the final amount. A code never makes the total higher than the same cart without a code. A cart whose total is already below `M` without a code gets today's `below_minimum` before any code check, on Apply and on Pay.
- **AC-3**: A code is refused with exactly these messages, checked in this order, the first that applies wins:
  1. text not matching `^[A-Z0-9-]{3,32}$` after trim and uppercase, no such code, `active` false, or `starts_at` after now: "This code isn't valid."
  2. `ends_at` at or before now: "This code has expired."
  3. redemptions of the code at or above `max_redemptions`: "This code has been used up."
  4. subtotal below `min_subtotal_cents`: "Add <amount> more to use this code." (amount = minimum minus subtotal, formatted in `STORE_CURRENCY`)
  5. redemptions of the code with this order email at or above `per_customer_limit`: "You've already used this code."
  6. the AC-2 caps leave a discount of 0: "This order is too small for this code."

  A redemption counts as a use when its order has ever been paid (`paid_at` set), or is `pending_payment` and was created less than 35 minutes ago (the session lives at most 31). An older pending order, such as one left without a session by a crash or flagged for attention, no longer holds a use. On Apply and the prefill, both counts also leave out the redemption of this cart's own pending order (Pay replaces that order first); Pay counts every use under the code lock, because `clearPendingOrder` has already expired that order. Apply runs check 5 only when the email is known: signed in (the account email), or the email field holds a valid email. Pay always runs all six. Emails are compared after the one shared normaliser (`normalizeEmail` in `src/lib/discounts/schema.ts`: trim, lowercase), which the checkout email schema also uses. Starts are inclusive, ends exclusive, and "now" is the database clock.
- **AC-4**: Pay sends the applied code with the form. Inside the order transaction, after the customer lock and the cart lock, `startCheckout` locks the code row (`SELECT ... FOR UPDATE`), reruns AC-2 and AC-3 against the locked cart, the live `store_settings` and the order email (account email when signed in). On a refusal it returns `discount_refused` with the reason, creates no order, keeps every form field, shows the AC-3 message under the code field, moves focus there, and the summary drops back to the totals without a code. Otherwise it writes the order with `discount_code_id`, `discount_code`, `discount_type`, `discount_value`, `discount_cents`, the lines with their split (AC-6), and one `discount_redemptions` row (code id, order id, lowercased email) in the same transaction.
- **AC-5**: Two checkouts racing for the last use of a code (or the last use for one email) end with exactly one redemption; the other customer gets "This code has been used up." (or "You've already used this code.") and no order.
- **AC-6**: The order discount is split across lines in proportion to each line's `unit_price_cents * quantity`, each share rounded down, then the leftover cents go one each to the lines with the largest remainders (ties by cart line order). The line discounts sum to the order discount, no line discount exceeds its line, and the spec 0002 CHECKs hold (`line_total = unit_price * quantity - discount`, `sum(line_total) = subtotal - discount`, `total = subtotal - discount + shipping`).
- **AC-7**: When the discount is above 0, after the order commits and before the Checkout Session, `startCheckout` creates a Stripe coupon with the fixed `id` `order_<orderId>`, `amount_off` = `discount_cents`, `currency` = `STORE_CURRENCY`, `duration: "once"`, `max_redemptions: 1`, `name` = the code, `metadata.order_id`, idempotency key `coupon:<orderId>`, and passes it as the session's `discounts: [{ coupon }]`. A create that answers "already exists" for that id reuses it. The session's `amount_total` equals the order's `total_cents`. If creating the coupon fails, the order is expired with the reason "Stripe coupon could not be created" (which frees the use, AC-8), `checkout.coupon_failed` is logged, and the customer gets `payment_unavailable`. An `amount_too_small` from Stripe on an order with a code is logged as an error (the AC-2 cap should make it impossible) and still answers `below_minimum`. Without a code the session params are unchanged from today. Before building, check with the `stripe-docs` skill whether Checkout Session create accepts an inline coupon in `discounts`; if it does, use that instead of the separate create, and drop the coupon failure path.
- **AC-8**: `markExpired` and `markCancelled` (from `pending_payment`) delete the order's redemption in the same transaction, which frees that use. A paid order keeps its redemption through cancel, refund, undo cancel and account delete. Restarting checkout expires the earlier pending order (and frees its use) before the new order takes one.
- **AC-9**: Coming back to `/checkout` (Stripe's back link, a reload) after a Pay with a code: `checkoutPrefill` also returns the code of this cart's latest order, only when that order is `pending_payment` or `expired` and was created in the last 24 hours (with that order's email as the prefilled email, or the account email when signed in), and the page shows it applied when it still passes AC-3 for the prefilled email, or in the field with its refusal message when it does not.
- **AC-10**: `/admin/discounts` (new "Discounts" entry in the admin nav) lists codes newest first. Search and the status filter apply first (status is derived in the SQL with the database clock, the same rule as `codeStatus`), then at most 200 rows are shown, with "Showing the newest 200 codes" when more match. Uses and discount given come from grouped subqueries in the same query. Columns: code, discount ("10%" or "<amount> off", every amount in this spec shown through `formatMoney` in `STORE_CURRENCY` and `STORE_LOCALE`), status (the first that applies of Inactive, Used up, Expired, Scheduled, Active), uses ("12 / 100", or "12" without a limit, counted by the AC-3 use rule, so recent pending holds count and older pending orders do not), starts and ends in `STORE_TIMEZONE` ("No end" when null), discount given (sum of `orders.discount_cents` over orders with the code and `paid_at` set), and an "Orders" link to `/admin/orders?discount=<id>`. A search box matches the code (case insensitive substring) and a status filter narrows the list. Empty state: "No codes yet" with a "New code" button.
- **AC-11**: `/admin/discounts/new` creates a code with: Code (required, trimmed, uppercased, `^[A-Z0-9-]{3,32}$`), Type (Percent or Fixed amount), Value (percent: whole number 1 to 100; fixed: money through `parseMoney`, above 0), Starts at and Ends at (optional `datetime-local`, read in `STORE_TIMEZONE`, stored UTC, end after start), Total use limit and Per customer limit (optional whole numbers above 0), Minimum subtotal (optional money above 0), Active (default on), Note (optional, at most 500 characters). Each invalid field shows its message from *Validation messages*; the first invalid field gets focus. It sets `created_by_admin_id`. A duplicate code shows "A code with this name already exists." on the Code field.
- **AC-12**: `/admin/discounts/[id]` edits a code with the same form. Once the code has any redemption, Code, Type and Value show as read only with the hint "Locked after first use", and the action refuses a change to them ("This code has been used, so its code, type and value can't change."), checked under the code row lock. A form older than the row's `updated_at` is refused with "This code changed since you opened it. Reload to see the latest." Lowering a limit below the current uses is allowed (the code shows Used up). It sets `updated_by_admin_id`. The page also shows the uses, the discount given and the Orders link from AC-10.
- **AC-13**: The edit page offers Delete (with a confirm dialog) only while the code has no redemption. The action rechecks under the code row lock and refuses with "This code has been used. Deactivate it instead." Orders that once pointed at a deleted code (expired or cancelled while pending) keep their snapshot text.
- **AC-14**: `/admin/orders?discount=<id>` lists only orders with that `discount_code_id`, with a removable chip showing the code; an id that is not a uuid or not a code is ignored like the list's other bad params. `/admin/orders/[number]` shows "Discount (SUMMER10, 10%)" or "Discount (SUMMER10, 5.00 off)" from the order's snapshot, linking to the code while it still exists.
- **AC-15**: When `discount_cents` is above 0, `/checkout/complete`, `/account/orders/[number]` and the order confirmation email show the row as "Discount (SUMMER10)" with the amount. This amends spec 0011 AC-4 and spec 0012 AC-12, which showed "Discount" alone. Stripe's hosted page shows the coupon under the code's name.
- **AC-16**: Refunds use the discounted line totals: refunding every unit plus delivery suggests exactly `total_cents`, a partial refund suggests from the discounted `line_total_cents` (spec 0010), and the order keeps its discount snapshot after any refund.
- **AC-17**: Every `/admin/discounts` page and action calls `requireAdmin()`. Apply is public, reads the cart only from the signed cookie and prices, settings and code rows only from the database, and its answer carries only the AC-1 totals or an AC-3 refusal, never a code's limits, counts or note.
- **AC-18**: Logs: `discount.created`, `discount.updated` (changed field names, compared with the row read under the code lock), `discount.deleted` (code id, admin id); `checkout.discount_refused` (reason, code id when the code exists); `checkout.started` gains `discountCents` and `discountCodeId`. Never an email, and never the typed text of a code that does not exist.
- **AC-19**: One migration adds `discount_codes.note` (text, nullable, CHECK at most 500 characters), `created_by_admin_id` (uuid, NOT NULL, references `admin_users`, Restrict), `updated_by_admin_id` (uuid, nullable, references `admin_users`, Restrict), CHECK `code ~ '^[A-Z0-9-]{3,32}$'`, and an index on `orders.discount_code_id`. No data change (no code exists yet).
- **AC-20**: `/checkout` with a code applied and with a code refused, `/admin/discounts`, and the new and edit forms pass axe with no violations and work by keyboard alone.

## Decision

**Chosen option**: Option 1: Our own codes, checked twice, discount split onto lines, a one off Stripe coupon per order

Codes live in our database and are checked on Apply and again under a row lock on Pay; the order and its lines carry the discount; Stripe gets a single use amount coupon with our exact amount, so `amount_total` always equals our total.

**Implementation skills**: `stripe-best-practices` (`stripe/ai`, `.agents/skills/stripe-best-practices/`) · `stripe-docs` (`stripe/ai`, `.agents/skills/stripe-docs/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`)

**Decisions made in the conversation**: items subtotal only, delivery never discounted · code entered on `/checkout` only, held in form state · applies on top of sale prices · specific refusal messages · discount capped to keep the total at Stripe's minimum · per customer limit counted by order email · all four optional limits (dates, total uses, per customer, minimum subtotal) · a pending order holds a use until it expires or is cancelled · code, type and value lock after the first use · delete only when never used · list shows uses, status, discount given and an orders link · Pay refuses a code that stopped being valid and keeps the form · note, created by and updated by columns plus the index · code format `A-Z 0-9 -`, 3 to 32 · redemptions kept on account delete · one off amount coupon per order on Stripe · rate limit through a Vercel Firewall rule at deploy · Apply checks the per customer limit when the email is known · dates with time in `STORE_TIMEZONE` · code shown on the admin order page, account order page, confirmation email and `/checkout/complete` · a paid order's use is never given back · one page admin list, no paging.

**Decisions made while writing (with the runner up)**:
- **Percent rounding: half up** on the integer product. Runner up: round down (always in the store's favour); half up matches what a customer works out by hand.
- **Line split: largest remainder** in proportion to line value, ties by cart line order. Runner up: put the whole discount on the most expensive line; proportional keeps partial refunds fair per unit.
- **Pure rules in `src/lib/discounts/`**, admin UI in `src/features/discounts/`. Checkout and the admin both need the rules, and a feature may not import another feature's internals. Runner up: rules inside `src/features/checkout/`, which would force the admin to import checkout internals.
- **One preview function for Apply and the prefill** (`previewDiscount`), so the page render and the button can never disagree. Runner up: the prefill fills the field and the client calls Apply on mount, which flashes the undiscounted total first.
- **Admin edits use the `updated_at` stale check** the order actions use. Runner up: last write wins, which can silently undo another admin's limit change.
- **Orders filter by code id** (`?discount=<id>`), not by code text. Runner up: by text, which breaks for a deleted code whose text is reused.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

| Path | Owns |
|---|---|
| `src/lib/discounts/rule.ts` | Pure. `discountCents(code, subtotalCents)` (AC-2 raw amount), `cappedDiscount({ raw, subtotalCents }, settings, minimumCents)` (both caps, delivery recomputed), `splitDiscount(lines, discountCents)` (AC-6), `refusal(code, facts)` (AC-3 order, returns the first reason or null), `codeStatus(code, uses, now)` (AC-10 label), `discountLabel(type, value, currency)` ("10%" / "5.00 off"), `refusalMessage(reason, money)`. |
| `src/lib/discounts/schema.ts` | Pure. `discountCodeTextSchema` (trim, uppercase, format), safe to run twice. |
| `src/lib/discounts/codes.ts` | `import "server-only"`. `findCode(client, text)`, `lockCode(tx, id)` (`FOR UPDATE`), `countRedemptions(client, codeId, { email?, exceptCartId })`, `redeem(tx, { codeId, orderId, email })`, `previewDiscount({ cartId, codeText, email })`. |
| `src/lib/orders/snapshot.ts` | `snapshotOrder(sources, settings, discount)` gains `{ codeId, discountCents } \| null`, already final from `cappedDiscount` (the cap logic lives only in `rule.ts`), and fills the line split; `NO_DISCOUNT_CENTS` goes away. |
| `src/lib/orders/transitions.ts` | `markExpired` and `markCancelled` (pending path) delete the order's redemption (AC-8). |
| `src/features/checkout/actions/apply-discount.ts` | `applyDiscountCode` (AC-1, AC-3). |
| `src/features/checkout/actions/start-checkout.ts`, `schemas.ts`, `stripe-session.ts`, `queries.ts` | `discountCode` input, lock and redeem, coupon and `discounts`, prefill code (AC-4, AC-7, AC-9). |
| `src/features/checkout/components/discount-field.tsx` | The code field, Apply and Remove, live region; the summary rows become a client part fed by the server totals or the Apply answer. |
| `src/features/discounts/` | Admin: `schemas.ts`, `actions/` (`createDiscountCode`, `updateDiscountCode`, `deleteDiscountCode`), `queries.ts` (list with uses and discount given, one code), `components/` (list, form, delete dialog), `log.ts`, `AGENTS.md` later by `/sync`. |
| `app/admin/(panel)/discounts/page.tsx`, `new/page.tsx`, `[id]/page.tsx` | Thin routes. |
| `src/lib/dates.ts` | `zonedDateTimeToUtc(text, timeZone)` and `utcToZonedInput(date, timeZone)` for `datetime-local`. |

### Data model sketch

Tables exist from spec 0002; **bold** is new in this spec's migration.

| Table | Columns this feature uses | Rules |
|---|---|---|
| `discount_codes` | id, code, type `discount_type` (`percent`, `fixed_amount`), value int, starts_at?, ends_at?, max_redemptions?, per_customer_limit?, min_subtotal_cents?, active (default true), **note text?**, **created_by_admin_id uuid → admin_users Restrict**, **updated_by_admin_id uuid? → admin_users Restrict**, created_at, updated_at | code unique; CHECK `code = upper(code)`; **CHECK `code ~ '^[A-Z0-9-]{3,32}$'`**; **CHECK `char_length(note) <= 500`**; percent value 1 to 100, fixed above 0; ends_at > starts_at; limits above 0. Code, type and value never change once a redemption exists (action rule, under the row lock). |
| `discount_redemptions` | id, discount_code_id → discount_codes Restrict, order_id → orders Cascade (unique), email (lowercased), created_at | Inserted by `startCheckout` under the code lock; deleted by `markExpired` and `markCancelled` from `pending_payment`; kept otherwise. Index (discount_code_id, email) exists. |
| `orders` | discount_code_id? → discount_codes SetNull, discount_code?, discount_type?, discount_value?, discount_cents | **Index on discount_code_id**. Snapshot written once at Pay, never changed. |
| `order_lines` | discount_cents, line_total_cents | Split per AC-6. |

Relationships: code 1:N redemptions; redemption 1:1 order; code 1:N orders (snapshot link); admin 1:N codes created, 1:N codes last edited. RLS is already on both tables with no policies. Migration via `pnpm db:migrate`; the CHECKs go in the migration SQL (Prisma does not model them). The Prisma models gain `note`, `createdByAdminId`, `updatedByAdminId` and the relations, and `Order` gains `@@index([discountCodeId])`.

### State transitions

No new order states. A redemption exists while its order is `pending_payment` (a held use) or has ever been paid (a spent use):

- Pay with a code: no redemption → redemption (same transaction as the order).
- `pending_payment` → `expired` (`markExpired`) or → `cancelled` (`markCancelled`, pending path): redemption deleted.
- `pending_payment` → `paid` and every later move (shipped, delivered, cancelled, undo cancel, refunds): redemption kept.

Code status (derived, never stored): `active = false` → Inactive; else uses ≥ `max_redemptions` → Used up; else `ends_at` ≤ now → Expired; else `starts_at` > now → Scheduled; else Active.

### API surface

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `applyDiscountCode` | server action, read only | `code: string` (req), `email: string` (opt, used only when valid) | `{ code, discountCents, shippingCents, totalCents }` | public; reads the same cart the `/checkout` page renders (the account cart when signed in), never merges carts | `below_minimum` (before any code check); `discount_refused` with `reason` and `minimumGapCents` for reason `below_minimum_subtotal`; `cart_changed` (with `merged` when a guest cart still waits to join the account cart) when there is no cart or it cannot be bought |
| `startCheckout` | server action (extended) | today's fields + `discountCode: string` (opt) | `{ url }` | public, cart from cookie | today's codes + `discount_refused` (`reason`, `minimumGapCents`) |
| `/checkout` page | page (extended) | prefill from `checkoutPrefill` | summary with applied code or refusal | public, `noindex` | none new |
| `/admin/discounts` | page | `q`, `status` (`active`, `scheduled`, `expired`, `used_up`, `inactive`) | list per AC-10 | `requireAdmin()` | bad params ignored |
| `/admin/discounts/new`, `/admin/discounts/[id]` | pages | `id` | form | `requireAdmin()` | unknown id: not found |
| `createDiscountCode` | server action | form fields (AC-11) | `{ id }` | `requireAdmin()` | `validation` (`fields`), `code_taken` |
| `updateDiscountCode` | server action | `id`, `updatedAt`, form fields | `{ id }` | `requireAdmin()` | `validation`, `code_taken`, `locked_fields`, `stale`, `not_found` |
| `deleteDiscountCode` | server action | `id` | `{}` | `requireAdmin()` | `used`, `not_found` |
| `/admin/orders` | page (extended) | `discount=<uuid>` | filtered list, chip | `requireAdmin()` | bad id ignored |
| Stripe `coupons.create` | outbound | per AC-7 | coupon id | secret key | any error → order expired, `payment_unavailable` |

Refusal reasons (`DiscountRefusal`): `invalid`, `expired`, `used_up`, `below_minimum_subtotal`, `customer_limit`, `too_small`.

### Validation messages

| Field | Rule | Message |
|---|---|---|
| Code | empty | "Enter a code." |
| Code | format | "Use 3 to 32 letters, digits or hyphens." |
| Code | taken | "A code with this name already exists." |
| Type | missing | "Choose a type." |
| Value (percent) | not a whole number 1 to 100 | "Enter a whole percent from 1 to 100." |
| Value (fixed) | not money above 0 | "Enter an amount above 0." |
| Ends at | not after Starts at | "The end must be after the start." |
| Starts at, Ends at | not a valid date and time | "Enter a valid date and time." |
| Total use limit, Per customer limit | not a whole number above 0 | "Enter a whole number above 0, or leave it empty." |
| Minimum subtotal | not money above 0 | "Enter an amount above 0, or leave it empty." |
| Note | over 500 characters | "Keep the note under 500 characters." |

### Value sourcing

| Action | Value | Source |
|---|---|---|
| `applyDiscountCode`, `previewDiscount` | cart lines and subtotal | cart id from the signed cookie, live variant prices from the DB (no lock; Pay rechecks) |
| same | delivery and total | `orderCharges` (spec 0007) with `readShippingSettings()` and the capped discount |
| same | Stripe minimum | `minimumChargeCents(env.STORE_CURRENCY)` |
| same | the email for check 5 | signed in: `getCustomer().email`; guest: the `email` input when it parses with the checkout email schema, else check 5 skipped |
| same | redemption counts | `countRedemptions` over `discount_redemptions` joined to `orders`, under the AC-3 use rule, leaving out (Apply and prefill only) the row whose order is this cart's `pending_payment` order |
| same | "now" for dates | the DB clock (`now()`) in the query, so Apply and Pay use one clock |
| same | "Add <amount> more" | `min_subtotal_cents - subtotal`, formatted with `formatMoney` in `STORE_CURRENCY` and `STORE_LOCALE` |
| `startCheckout` | discount, line split, totals | `snapshotOrder(lockedLines, settings, lockedCode)` inside the order transaction |
| same | order email for the redemption and check 5 | account email when signed in, else the typed email (as today), lowercased |
| same | `discount_code`, `discount_type`, `discount_value` | the locked `discount_codes` row |
| same | coupon `amount_off`, `currency`, `name` | `orders.discount_cents`, `STORE_CURRENCY`, `orders.discount_code` |
| `checkoutPrefill` | the code to show | `orders.discount_code` of the cart's latest order, then `previewDiscount` with the prefilled email |
| `/admin/discounts` | uses | count of `discount_redemptions` per code under the AC-3 use rule (paid, or pending and under 35 minutes old, by the DB clock) |
| same | discount given | `sum(orders.discount_cents)` where `discount_code_id` = the code and `paid_at` is not null |
| same | status | `codeStatus` over the row, its uses and the request time |
| same, forms | dates shown and parsed | `STORE_TIMEZONE` through the new `src/lib/dates.ts` helpers |
| `createDiscountCode`, `updateDiscountCode` | `created_by_admin_id`, `updated_by_admin_id` | `requireAdmin()` result |
| admin order page | discount row text | `orders.discount_code`, `discount_type`, `discount_value`, `discount_cents`, `currency` |
| complete page, account order page, confirmation email | "Discount (CODE)" | `orders.discount_code`, `discount_cents`, `currency` |

### Key invariants

- The only place a discount amount is worked out is `src/lib/discounts/rule.ts`; Apply, the prefill and Pay all call it.
- Pay is the truth. Whatever Apply showed, `startCheckout` rechecks under the code lock and charges what it computes there; Stripe's hosted page shows that amount before the customer pays.
- Lock order: customer, then cart, then code. The code lock is taken before the order, line and redemption inserts (whose foreign keys touch the code row). Every writer of a code row (`updateDiscountCode`, `deleteDiscountCode`) takes the code lock first, checks under it, and sets `updated_at = now()` itself (raw SQL skips `@updatedAt`).
- Order of checks on Pay: input validation, cart, `below_minimum` without a code, then the code (AC-3). When Pay's numbers differ from what Apply showed (a price or a setting changed) but nothing is refused, Pay goes on with the new numbers, as it does today for delivery; Stripe's page shows the final total.
- At most one redemption per order (unique `order_id`); a redemption exists only for an order that is `pending_payment` or was paid.
- `discount_cents <= subtotal_cents`, `total_cents >= minimumChargeCents` whenever a code applies, and the spec 0002 total and line CHECKs hold.
- Stripe's `amount_total` equals `orders.total_cents` (the webhook's existing amount mismatch check would flag anything else).
- A code's code, type and value never change after its first redemption, so every order's snapshot matches its code.
- No transaction is held across a Stripe call: the coupon and the session are created after the order commits.

### Security model

- Admin pages and actions: `requireAdmin()` in each (the proxy is only a first gate). Codes, limits, counts and notes are admin only.
- Apply and Pay: public. Inputs are the typed code and email only; prices, settings and code rows come from the database, the cart from the signed cookie. Answers carry totals or a refusal reason only.
- Code guessing: the specific messages tell a guesser that a code exists but is expired or used up. Accepted for a small store; slowed by a Vercel Firewall rate limit rule on `POST /checkout` at deploy (Follow-up).
- Personal data: `discount_redemptions.email` is order data, kept with the order (same as `orders.email`); never logged. Expired orders lose their redemption at expiry, before the spec 0008 purge.
- Money: the discount is computed server side only and sent to Stripe as an amount we computed; Stripe never computes our discount.

### Observability

`discount.created`, `discount.updated` (changed field names only), `discount.deleted` with code id and admin id; `checkout.discount_refused` with reason and code id when the code exists (Apply and Pay both log it, with `stage: "apply" | "pay"`); `checkout.started` gains `discountCents` and `discountCodeId`; `checkout.coupon_failed` (error) with order id and `stripeCode`. Never the email, never typed text of an unknown code.

### Configuration required

None. Stripe keys, `STORE_CURRENCY`, `STORE_TIMEZONE` and `STORE_LOCALE` already exist.

### Critical test scenarios

- Happy path: admin creates `SUMMER10` (10%), customer applies it, sees the discount and new total, pays in Stripe test mode, the order has the snapshot and split lines, the admin order page shows "Discount (SUMMER10, 10%)", verifies **AC-1**, **AC-4**, **AC-6**, **AC-7**, **AC-11**, **AC-14**
- Rule edges: percent rounding half up, fixed above subtotal capped, cap to Stripe minimum with delivery recomputed across the free threshold, cap leaving 0, split remainders and ties, verifies **AC-2**, **AC-3**, **AC-6**
- Refusal order: each of the six reasons, and an earlier reason winning over a later one, verifies **AC-3**
- Pay recheck: code deactivated after Apply, Pay refused with the message and no order, verifies **AC-4**
- Concurrency: two transactions racing for the last use and for the last per email use, exactly one redemption, verifies **AC-5**
- Lifecycle: expire and pending cancel delete the redemption; paid cancel, refund and undo cancel keep it; restarting checkout with a per customer limit of 1 still succeeds, verifies **AC-8**, **AC-9**
- Stripe: session params carry `discounts` and `amount_total` equals `total_cents`; coupon failure expires the order and frees the use, verifies **AC-7**
- Admin rules: duplicate code, locked fields after first use, stale form, delete refused when used, verifies **AC-11**, **AC-12**, **AC-13**
- Display: list status labels, uses, discount given, orders filter; complete page, account page and email show the code, verifies **AC-10**, **AC-14**, **AC-15**
- Refund: full refund suggestion equals `total_cents` on a discounted order, including a 100% code with line totals of 0 where only delivery is left to refund, verifies **AC-16**
- Never dearer: a code that would push the subtotal under the free threshold is trimmed so the total is not above the no code total, verifies **AC-2**
- Stale holds: a pending order older than 35 minutes no longer counts as a use, verifies **AC-3**
- Webhook: a paid discounted order records no amount mismatch, verifies **AC-7**
- Auth/permission: a signed out visitor and a customer get the admin gate on every `/admin/discounts` page and action; Apply's answer has no limits or counts, verifies **AC-17**
- Accessibility: axe and keyboard on checkout (applied, refused) and the admin pages, verifies **AC-20**

## Build plan

Tracer Bullet: tasks 1 to 5 push one real code through every layer (migration, rule, admin create, Apply, Pay with the lock and redemption, Stripe coupon, webhook paid, admin order page). Later tasks thicken each segment.

1. [x] Migration for the new columns, CHECKs and index; update the Prisma models; DB test for the format and note CHECKs, satisfies **AC-19**
2. [x] `src/lib/discounts/rule.ts` and `schema.ts` with Vitest tests for every rule edge (rounding, both caps, split, refusal order, status, label); `snapshotOrder` takes the applied code and fills the split, `snapshot.test.ts` updated, satisfies **AC-2**, **AC-3**, **AC-6**
3. [x] `src/lib/discounts/codes.ts` (find, lock, count leaving out the cart's own pending order, redeem, `previewDiscount`); `markExpired` and `markCancelled` delete the redemption; DB tests for the counts, the delete, and the last use race for total and per email limits, satisfies **AC-3**, **AC-5**, **AC-8**
4. [x] `src/features/discounts/`: schemas, `createDiscountCode`, the form and `/admin/discounts/new` with `requireAdmin()`, the `datetime-local` helpers in `src/lib/dates.ts`, Vitest for the schema and action, satisfies **AC-11**, **AC-17**
5. [x] Checkout thread: `applyDiscountCode`, `DiscountField` and the client summary rows; `startCheckout` takes `discountCode`, locks, rechecks, writes the snapshot and the redemption, creates the coupon (check params with the `stripe-docs` skill) and passes `discounts`; `checkoutSessionParams` and its tests; the admin order page discount row; update `tests/db/start-checkout.db.test.ts`; e2e happy path through Stripe test mode (`@stripe`), satisfies **AC-1**, **AC-4**, **AC-7**, **AC-14**
6. [x] Every refusal end to end: messages, `minimumGapCents`, focus and live region on Apply and on Pay's `discount_refused`, the summary dropping back, logs `checkout.discount_refused` and the `checkout.started` fields, coupon failure path, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-7**, **AC-18**
7. [x] Prefill: `checkoutPrefill` returns the code, the page renders it through `previewDiscount`; DB test for the restart with a per customer limit of 1, satisfies **AC-8**, **AC-9**
8. [x] Admin list, edit and delete: queries (uses, discount given, status, search, filter, 200 cap), `updateDiscountCode` (lock, stale check, locked fields), `deleteDiscountCode`, the nav entry, logs; Vitest and DB tests, satisfies **AC-10**, **AC-12**, **AC-13**, **AC-17**, **AC-18**
9. [x] Admin orders `discount` filter and chip, the link from the code pages, satisfies **AC-10**, **AC-14**
10. [x] Customer facing rows: `/checkout/complete`, `/account/orders/[number]`, the confirmation email template and its preview fixture, satisfies **AC-15**
11. [x] Refund check: DB test that a discounted order's full refund suggestion equals `total_cents` and a partial one uses the discounted line totals, satisfies **AC-16**
12. [x] Playwright in `tests/e2e/checkout/` and `tests/e2e/admin/`: apply, remove, each visible refusal, Enter runs Apply, Pay refused after deactivation, admin create, edit lock, delete refusal, list and filter, axe and keyboard on every touched page, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-10** to **AC-13**, **AC-20**

## Consequences

**Positive**:
- One rule module feeds Apply, the prefill and Pay, and the database CHECKs from spec 0002 catch any total that does not add up.
- Refunds, emails, the account page and the coming sales dashboard need no discount logic of their own: the discount sits in the order and line snapshot.
- Stripe never computes our discount, so the webhook's amount check stays a real alarm.

**Negative / tradeoffs**:
- One Stripe coupon is created per discounted checkout, including checkouts never paid. They pile up in the Stripe dashboard (harmless, single use).
- Pay makes one more Stripe call when a code is used, one more thing that can fail (handled by expiring the order).
- Specific messages tell a guesser which codes exist; the rate limit only arrives with the deploy.
- A pending order holds a use for up to 35 minutes, so a code with one use left can show "used up" to a second customer while the first is still on Stripe's page. A delayed payment method that settles after 35 minutes can take a code one over its limit (accepted, rare).
- When a customer restarts checkout, their own hold is freed before Pay takes the lock, so another customer can take the last use in between; the first then sees "used up" (accepted).
- A guest can dodge a per customer limit with a different email, including `+tag` or dotted variants of the same inbox (accepted for a small store).
- Uses of paid orders are never given back, even after a refund, so "Used up" does not reset when orders are refunded.

**Neutral**:
- `snapshotOrder` gains a third parameter, and every caller and test changes.
- Specs 0011 (AC-4) and 0012 (AC-12) are amended to show the code text.
- Two spec 0002 follow ups are settled here: the discounted total stays above Stripe's minimum (AC-2) and the line split rule (AC-6).

## Follow-up

- [ ] Add a Vercel Firewall rate limit rule on `POST /checkout` (where Apply and Pay post) with the production deploy, feature 19 (spec 0001's planned promo rate limit).
- [ ] Tick spec 0002's two feature 14 follow ups once this ships (minimum charge, line split).
- [ ] Feature 15 (sales dashboard) can reuse "discount given" from `src/features/discounts/queries.ts` instead of a second query.
- [ ] If Stripe dashboard clutter from single use coupons ever matters, add a cleanup of coupons whose order expired (not needed now).
