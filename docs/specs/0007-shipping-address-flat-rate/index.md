# 0007. Shipping address and flat rate delivery

**Date**: 2026-09-30
**Status**: In Progress

## Summary

Checkout now asks where to deliver and charges one flat delivery fee, which drops to zero once the order reaches an amount the admin sets. The customer types the address on our own `/checkout` form, next to the email; the server saves it on the pending order, works out the fee from `store_settings` (the one row of store wide settings), and hands both to Stripe so the payment page shows a real delivery row. Admins set the fee and the free delivery threshold on a new `/admin/settings` page and see the address on every order. No database migration is needed: the columns already exist from spec 0002.

## Requirements

**User stories**:
- As a customer, I want to type my delivery address once at checkout and see the delivery fee before I pay, so I know exactly what I am charged and where it goes.
- As a customer, I want to see how much more I need to spend for free delivery, so I can decide to add something.
- As a customer who backed out of the payment page, I want my details still filled in when I return, so I do not type them again.
- As an admin, I want to set the delivery fee and the free delivery threshold myself, so I can change pricing without a deploy.
- As an admin, I want to see the delivery address and phone on each order, so I can ship it.

**Acceptance criteria**:
- **AC-1**: `/checkout` shows, above the Pay button, the fields Email, Full name, Address line 1, Address line 2 (optional), Postal code, City, Phone (optional), and the country as plain text (the name of `STORE_COUNTRY` in `STORE_LOCALE`, e.g. "Poland"), not as an input. Each field has a visible label and the matching `autocomplete` token (`email`, `shipping name`, `shipping address-line1`, `shipping address-line2`, `shipping postal-code`, `shipping address-level2`, `tel`).
- **AC-2**: The same Zod schema checks the form (on submit) and `startCheckout` (on the server). Full name, line 1 and city are required after trimming (only spaces counts as empty); name, line 1 and line 2 accept up to 100 characters, city up to 60. The postal code, after trimming, must match `^[0-9]{2}-?[0-9]{3}$` (ASCII digits only; `00 950`, an en dash, or other digit scripts are refused) and is stored as `NN-NNN`. Phone, when given, must match `^\+?[0-9 ()-]+$` and hold 7 to 15 digits counted over digits only (`+48 600 100 200` passes), and is stored trimmed as typed; an empty phone is stored as null, an empty line 2 as null. Each invalid field shows its own message (see *Validation messages*), announced to screen readers, and focus moves to the first invalid field. A server refusal names the same fields and messages.
- **AC-3**: Delivery is `0` when `store_settings.free_shipping_threshold_cents` is set and `subtotal_cents - discount_cents` is at or above it; otherwise it is `store_settings.flat_shipping_cents`. A flat fee of 0 means delivery is always free. This one pure function is the only place the rule lives.
- **AC-4**: The `/checkout` summary lists Subtotal, a delivery row labelled "Standard delivery" with the fee (or "Free delivery" with "Free" when the fee is 0), and Total; the Pay button reads `Pay <total>` including delivery.
- **AC-5**: On Pay, `startCheckout` reads `store_settings` inside the same transaction that locks the cart (never from the cache, never from the browser), computes delivery with the AC-3 rule, and creates the pending order with `ship_full_name`, `ship_line1`, `ship_line2`, `ship_city`, `ship_postal_code`, `ship_country_code` (= `STORE_COUNTRY`), `phone`, `shipping_cents`, and `total_cents = subtotal_cents - discount_cents + shipping_cents`. The Stripe minimum charge check uses that total, delivery included.
- **AC-6**: The Stripe Checkout Session carries exactly one shipping option: `shipping_rate_data` of type `fixed_amount` with `amount = shipping_cents`, the store currency, and display name "Standard delivery" (or "Free delivery" when 0). It also carries `payment_intent_data.shipping` with the name, address (line1, line2, city, postal code, country) and phone. The session's `amount_total` equals the order's `total_cents`, so spec 0006's amount check stays quiet on every normal order.
- **AC-7**: If an admin changes the fee or threshold while a customer is on `/checkout`, Pay charges the settings in effect at Pay; Stripe's page shows that total before anyone pays. No error is raised.
- **AC-8**: `/cart` shows Subtotal, the delivery row (AC-4 labels, from the current settings) and Total, replacing "Shipping is added at checkout". When a threshold is set and not yet met, it also shows "Add <amount> more for free delivery" (threshold minus `subtotal - discount`).
- **AC-9**: Returning to `/checkout` (after cancelling on Stripe, or a reload) prefills email, address and phone from the newest order (`created_at desc, id desc`) of the cart in the signed cart cookie, whatever its status. A null column prefills as an empty field. A cart with no order shows empty fields.
- **AC-10**: The admin nav has a "Settings" entry. `/admin/settings` shows a Shipping section with "Delivery fee" (money, required, 0.00 to 1,000.00) and "Free delivery from" (a checkbox; when checked, a money field from 0.01 to 100,000.00; unchecked stores null and ignores whatever the field holds). Money fields accept the same format as the catalog price field (`parseMoney`: a dot as the decimal mark; "9,99" shows "Enter an amount like 9.99."), and show the current values as plain decimals (e.g. `12.00`). Saving writes `store_settings`, shows the status "Shipping settings saved.", and the cart and checkout pages show the new values on their next load. The page and the action each call `requireAdmin()`.
- **AC-11**: `/admin/orders/[number]` shows a "Delivery address" block (full name, line 1, line 2 when set, postal code and city, country name, phone when set) and labels the shipping row "Standard delivery" or "Free delivery". An order with no address (made before this feature) shows "No address recorded".
- **AC-12**: `/admin/orders` gains a "Ship to" column showing `<full name>, <city>` (e.g. "Anna Kowalska, Warsaw"), or "Not recorded" when the order has none.
- **AC-13**: `/checkout/complete` shows a delivery row between Subtotal and Total paid, and a "Delivering to" block with the name and address. An order with no address (made before this feature) hides the block.
- **AC-14**: `checkout.started` logs `shippingCents`; saving settings logs `settings.shipping_updated` with the admin id and old and new values. No log ever carries a name, address line, postal code or phone.
- **AC-15**: `STORE_COUNTRY` is validated in `src/lib/env.ts` (only `PL` is accepted today, because postal code rules exist per country) and listed in `.env.example`; the server refuses to start without it.
- **AC-16**: The checkout form, the cart page, `/admin/settings` and both admin order pages work by keyboard and pass axe with no violations.

## Decision

**Chosen option**: Option 1: our own address form on `/checkout`, delivery computed server side from `store_settings`, passed to Stripe as a fixed amount shipping option

The address and the delivery fee are settled on our side before Stripe is called, frozen onto the pending order, and mirrored to Stripe as a shipping option plus payment intent shipping details; the admin edits the two settings on a new settings page.

**Implementation skills**: `stripe-best-practices` (`stripe/ai`, `.agents/skills/stripe-best-practices/`) · `stripe-docs` (`stripe/ai`, `.agents/skills/stripe-docs/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `accessibility` (`.agents/skills/accessibility/`) · `playwright-best-practices` (`.agents/skills/playwright-best-practices/`) · `next-dev-loop` (`.agents/skills/next-dev-loop/`)

**Calls made in this spec** (pick, why, runner up):
- **Shipping rule and address schema live in `src/lib/shipping/`**, not in a feature. The cart, checkout and admin settings all use the rule, and feature 12 (saved addresses) will reuse the address schema; `AGENTS.md` forbids one feature importing another's internals. Runner up: `src/features/checkout/`, which the cart and settings could not import.
- **Settings for display come from a `'use cache'` read tagged `store-settings`; Pay reads the row uncached in the order transaction.** Display stays fast and the charge is always current. Runner up: no cache, one extra query on every cart render.
- **`STORE_COUNTRY` is `z.enum(["PL"])`, with postal code rules in a per country map.** A country without a rule then fails at boot instead of accepting any postal code. Runner up: any ISO alpha 2 code with a loose postal check.
- **Validation errors return a field map**: `{ code: "validation"; fields: Partial<Record<CheckoutField, string>> }` with `CheckoutField = "email" | "fullName" | "line1" | "line2" | "postalCode" | "city" | "phone"`, replacing today's single `field: "email"`. The form maps each onto `setError`. Runner up: one error per request, which makes the customer fix fields one at a time.
- **Every schema transform is safe to run twice.** `handleSubmit` passes the parsed output to `startCheckout`, so the server parses already cleaned values: `00-950` stays valid, an email stays lowercase, and line 2 and phone accept `string | null | undefined` as input (output `string | null`). Form `defaultValues` are empty strings for all seven fields. Runner up: sending `form.getValues()` raw, which splits the client and server paths.
- **Settings money uses the catalog's `parseMoney` (dot only)**, plus a new `centsToInput(cents, currency)` in `src/lib/money.ts` for form defaults; ranges are checked in cents derived with `fractionDigits(currency)` (1,000.00 and 100,000.00 in major units). Runner up: accepting a comma, which should change every admin money field at once in its own change.
- **Phone is stored as typed (trimmed), not normalized to E.164.** One country, read by a person or courier; normalizing needs a phone library for no gain now. Runner up: `libphonenumber-js`.
- **`orders.customer_name` stays null.** It belongs to accounts (feature 12); the recipient is `ship_full_name`. Runner up: copy the full name into both.
- **No delivery estimate on the Stripe shipping rate.** The store has not committed to delivery times. Runner up: a fixed 1 to 3 business day estimate.
- **Settings save is last write wins** on the single row. A few trusted admins, one small form. Runner up: optimistic locking on `updated_at`.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

| Path | What |
|---|---|
| `src/lib/shipping/rule.ts` | pure `shippingCents({ subtotalCents, discountCents }, settings)`, `freeDeliveryGapCents(...)`, `deliveryLabel(cents)` |
| `src/lib/shipping/address.ts` | Zod `shippingAddressSchema` (fields, limits, messages), `normalizePostalCode(country, text)`, the per country postal rule map |
| `src/lib/shipping/settings.ts` | `import "server-only"`; `getShippingSettings()` (`'use cache'`, `cacheTag(storeSettingsTag)`), `readShippingSettings(tx)` (uncached, for Pay) |
| `src/lib/cache-tags.ts` | add `storeSettingsTag = "store-settings"` |
| `src/lib/orders/snapshot.ts` | `snapshotOrder(sources, settings)` computes `shippingCents` with the rule |
| `src/lib/env.ts`, `.env.example` | `STORE_COUNTRY` |
| `src/features/checkout/` | `checkoutSchema` = email + `shippingAddressSchema`; `startCheckout` saves address and fee; `checkoutSessionParams` adds `shipping_options` and `payment_intent_data.shipping`; `checkoutPrefill(cartId)` query; form fields; summary delivery row; complete page delivery row and address |
| `src/features/cart/components/cart-contents.tsx` | delivery row, total, free delivery nudge |
| `src/features/settings/` (new) | `schemas.ts`, `actions/update-shipping-settings.ts`, `components/shipping-settings-form.tsx`, `log.ts` |
| `app/admin/(panel)/settings/page.tsx` | thin route calling the settings feature |
| `src/components/layout/admin-nav.ts` | add `{ href: "/admin/settings", label: "Settings", icon: SettingsIcon }` |
| `src/features/orders/` | `admin-queries.ts` selects ship fields and phone; list "Ship to" column; detail "Delivery address" block |

### Data model sketch

No migration. Columns this feature writes or reads (all from spec 0002):

| Table | Column | Type | Written by |
|---|---|---|---|
| `orders` | `ship_full_name`, `ship_line1`, `ship_city`, `ship_postal_code` | text, nullable in the DB, always set by `startCheckout` from now on | `startCheckout` |
| `orders` | `ship_line2`, `phone` | text, nullable | `startCheckout` (null when empty) |
| `orders` | `ship_country_code` | char(2), nullable in the DB, always `STORE_COUNTRY` from now on | `startCheckout` |
| `orders` | `shipping_cents` | int, CHECK total = subtotal − discount + shipping | `startCheckout` |
| `store_settings` (1 row, id 1) | `flat_shipping_cents` | int ≥ 0 (DB CHECK) | settings action |
| `store_settings` | `free_shipping_threshold_cents` | int ≥ 0 or null (null = never free) | settings action (form enforces ≥ 1 when set) |

The address stays nullable in the database because Slice 1 orders have none; the application schema is the gate (engineer's choice, no DB CHECK).

### State transitions

None new. The address and `shipping_cents` are written once when the `pending_payment` order is created and never change afterwards; spec 0006's transitions are untouched.

### API surface

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `startCheckout(input)` | server action | `email`, `fullName`, `line1`, `line2?`, `postalCode`, `city`, `phone?` (all strings) | `{ ok: true, data: { url } }` | public, cart from the signed cookie | `validation` with `fields` map; existing 0006 codes unchanged (`below_minimum` now counts delivery) |
| `checkoutSessionParams(order, opts)` | pure | order gains `shippingCents`, `shipping: { fullName, line1, line2, city, postalCode, countryCode, phone }` | Stripe params with `shipping_options` (one) and `payment_intent_data.shipping` | n/a | n/a |
| `checkoutPrefill(cartId)` | server query | cart id from `readCartId()` | `{ email, fullName, line1, line2, postalCode, city, phone } \| null` from the newest order with that `cart_id` | public, cart cookie | none (null when no order) |
| `getShippingSettings()` | cached server read | none | `{ flatShippingCents, freeShippingThresholdCents }` | server only | throws if the row is missing (a broken invariant) |
| `updateShippingSettings(input)` | server action | `deliveryFee: string`, `freeDelivery: boolean`, `freeDeliveryFrom?: string` | `{ ok: true, data: null }`; calls `updateTag(storeSettingsTag)` | `requireAdmin()` | `validation` with fields map (money format via `parseMoney`, ranges) |
| `/admin/settings` | page | none | the form with current values (uncached read) | `requireAdmin()` + proxy gate | n/a |
| `/admin/orders`, `/admin/orders/[number]` | pages | as spec 0006 | adds address, phone, delivery label | `requireAdmin()` | as spec 0006 |
| `/checkout/complete` | page | as spec 0006 | adds delivery row and "Delivering to" | public (session id) | as spec 0006 |

### Validation messages

Shared by client and server. "Empty" means empty after trimming.

| Field | Empty | Too long | Format |
|---|---|---|---|
| email | "Enter a valid email address." (unchanged) | same | same |
| fullName | "Enter your full name." | "Keep your name under 100 characters." | n/a |
| line1 | "Enter your street address." | "Keep this line under 100 characters." | n/a |
| line2 | allowed (null) | "Keep this line under 100 characters." | n/a |
| city | "Enter your city." | "Keep the city under 60 characters." | n/a |
| postalCode | "Enter a postal code like 00-950." | same | same |
| phone | allowed (null) | n/a | "Enter a phone number with 7 to 15 digits, or leave it empty." |

Settings: "Enter an amount like 9.99." (empty or bad format) · "Delivery fee can be at most 1,000.00." · "Enter an amount above 0." (threshold of 0) · "Free delivery threshold can be at most 100,000.00." Maximums are formatted with the store currency's decimals.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| `startCheckout` | `shipping_cents` | AC-3 rule over the locked cart's `subtotal_cents`, `discount_cents` (0 until feature 14) and `store_settings` read in the transaction |
| `startCheckout` | `ship_*`, `phone` | parsed input (`shippingAddressSchema`) |
| `startCheckout` | `ship_country_code` | `env.STORE_COUNTRY` (never the browser) |
| `startCheckout` | `total_cents` | `subtotal − discount + shipping` from the snapshot |
| Stripe session | shipping rate amount, display name | `order.shipping_cents`; `deliveryLabel(shipping_cents)` |
| Stripe session | shipping rate currency | `env.STORE_CURRENCY`, lowercased |
| Stripe session | `payment_intent_data.shipping` | the order's `ship_*` and `phone`; `country` = `ship_country_code`; line2 and phone keys omitted when null (never sent as `""`). `SessionOrder` gains required `shippingCents` and `shipping` |
| `/checkout` form | prefill, country name, delivery, total | props from `CheckoutSummary`: `prefill`, `countryName`, `shippingCents`, `totalCents`; the country shows as a labelled read only text block, not an input |
| `/checkout/complete` | delivery label, address, country name | order columns; country name computed on the server |
| `/checkout` summary, Pay button | delivery, total | `loadCart()` subtotal + `getShippingSettings()` + AC-3 rule |
| `/checkout` country text | "Poland" | `new Intl.DisplayNames([STORE_LOCALE], { type: "region" }).of(STORE_COUNTRY)` |
| `/checkout` prefill | email, address, phone | newest `orders` row with `cart_id` = cookie cart id |
| `/cart` | delivery, total, "Add X more" | `loadCart()` subtotal + `getShippingSettings()`; gap = `freeDeliveryGapCents` |
| `/admin/settings` | current values | `store_settings` row, uncached, shown with `centsToInput(cents, STORE_CURRENCY)` |
| `updateShippingSettings` | cents | `parseMoney(text, STORE_CURRENCY)` from `src/lib/money.ts` |
| `/cart`, `/checkout` summary | `discountCents` for the rule | 0 until feature 14 (the same constant `snapshotOrder` uses) |
| `/admin/orders` list | "Ship to" | `ship_full_name` and `ship_city` joined with ", " |
| Admin order pages, complete page | address, phone, delivery label | order row columns; `deliveryLabel(order.shipping_cents)`; country name as above from `ship_country_code` |
| `settings.shipping_updated` log | admin id, old, new | `requireAdmin()` result; row read before update in the same transaction |

### Key invariants

- The delivery fee a customer is charged is computed only on the server, from `store_settings` read inside the order transaction. The browser never sends a fee or a total.
- `orders.total_cents = subtotal_cents - discount_cents + shipping_cents` (DB CHECK, spec 0002), and the Stripe session's `amount_total` equals it.
- Every order created from now on has name, line 1, city, postal code (`NN-NNN`) and country set; only line 2 and phone may be null.
- The AC-3 rule exists in exactly one pure function; the cart, checkout summary, Pay and admin labels all call it.
- Whatever changes `store_settings` expires the `store-settings` tag (`updateTag` in the action).
- The address and delivery fee on an order never change after creation.

### Security model

- Checkout is public; the only identity is the signed cart cookie. The prefill reads orders by that cart id only, so a customer sees only what was typed in their own browser for their own cart. After payment the cart is deleted (spec 0006), so the prefill cannot reach a paid order.
- `/admin/settings` and `updateShippingSettings` each call `requireAdmin()`; the proxy is only the first gate. Every admin may edit settings (no roles exist).
- PII: full name, address and phone are personal data under GDPR (EU store). They are stored on `orders` only, shown only on admin pages and on the customer's own confirmation page, sent to Stripe as a processor, and never logged. Expired orders keep them for now (see Follow-up).
- No rate limiting beyond what spec 0006 has on `startCheckout`.

### Observability

- `checkout.started`: add `shippingCents` beside `orderId`, `number`, `totalCents`.
- `settings.shipping_updated` (info): `adminId`, `from: { flatShippingCents, freeShippingThresholdCents }`, `to: { ... }`.
- `checkout.refused` keeps logging only the error code; for `validation` it may add `Object.keys(fields)`, never the messages, the values or a Zod error object (its issues can echo the input).

### Configuration required

- `STORE_COUNTRY`: the one country the store ships to (ISO 3166 alpha 2). Accepts `PL` only today; drives the postal code rule, `ship_country_code` and the displayed country name.

### Critical test scenarios

- Happy path: fill the form with a valid Polish address, pay in Stripe test mode, the order shows the address, `shipping_cents` equals the flat fee, and Stripe's `amount_total` equals `total_cents`, verifies **AC-1**, **AC-5**, **AC-6**, **AC-11**
- Rule edges: subtotal one cent below, exactly at, and above the threshold; threshold null; fee 0, verifies **AC-3**, **AC-8**
- Postal codes: `00950` stored as `00-950`; `00 950`, `0095`, `ABCDE` refused on client and server, verifies **AC-2**
- Server trust: a crafted `startCheckout` call with a missing city or an extra `shippingCents` field is refused or ignored, and the fee comes from the DB, verifies **AC-2**, **AC-5**
- Settings race: change the fee after loading `/checkout`, press Pay, the order and the Stripe session use the new fee, verifies **AC-7**
- Minimum: a cart whose subtotal is below the Stripe minimum but whose total with delivery is above it can pay, verifies **AC-5**
- Prefill: cancel on Stripe, return, fields are filled; a fresh cart shows empty fields, verifies **AC-9**
- Auth/permission: signed out or non admin request to `/admin/settings` is redirected by the proxy, and calling `updateShippingSettings` directly returns the unauthorized result without writing, verifies **AC-10**
- Cache: after saving settings, `/cart` shows the new fee on the next load, verifies **AC-10**
- Logs: a checkout and a settings save produce no name, address or phone in the log output, verifies **AC-14**

## Build plan

Tracer Bullet: task 1 to 5 push one real address and one real fee through every layer (env, pure rule, DB, Stripe, admin view) with the default settings row; later tasks thicken each segment.

1. [x] Add `STORE_COUNTRY` to `src/lib/env.ts` (`z.enum(["PL"])`), `.env.example`, `tests/valid-env.ts`, the CI env in `.github/workflows/ci.yml`, and your `.env.local`; test the env schema, satisfies **AC-15**
2. [x] Add `src/lib/shipping/rule.ts` and `address.ts` (rule, gap, `deliveryLabel(cents)` returning the row label only, address schema with the PL postal rule, idempotent transforms and the *Validation messages*) with Vitest tests for every edge in *Critical test scenarios*, satisfies **AC-2**, **AC-3**
3. [x] Add `src/lib/shipping/settings.ts` and `storeSettingsTag`; change `snapshotOrder(sources, settings)` to compute the subtotal, then call `shippingCents`; update `src/lib/orders/snapshot.test.ts` (every one argument call breaks), satisfies **AC-3**, **AC-5**
4. [x] Extend `checkoutSchema` and `startCheckout`: field map validation errors, read settings in the order transaction, save address, phone, country and fee; extend `checkoutSessionParams` with `shipping_options` and `payment_intent_data.shipping` (check the params with the `stripe-docs` skill); add `shippingCents` to `checkout.started`; update `src/features/checkout/schemas.test.ts`, `stripe-session.test.ts` and `tests/db/start-checkout.db.test.ts` (inputs now need an address; `validation` has `fields`, not `field`), satisfies **AC-2**, **AC-5**, **AC-6**, **AC-14**
5. [x] Add the address fields and read only country to `CheckoutForm`, and the "Delivery address" block plus delivery label to `/admin/orders/[number]`; update the existing e2e specs in `tests/e2e/checkout/` that fill only the email; e2e: fill, pay (Stripe test mode), see the address in admin, satisfies **AC-1**, **AC-11**
6. [x] Checkout summary delivery row and Pay total; cart page delivery row, total and free delivery nudge, satisfies **AC-4**, **AC-8**
7. [x] `centsToInput` in `src/lib/money.ts` with tests; `src/features/settings/`: schema (via `parseMoney`, bounds from `fractionDigits`), `updateShippingSettings` (`requireAdmin`, read old row and update in one transaction, `updateTag`, log), form component, `app/admin/(panel)/settings/page.tsx`, nav entry; Vitest for the schema and action, satisfies **AC-10**, **AC-14**
8. [x] `checkoutPrefill` and form default values; `/checkout/complete` delivery row and "Delivering to" block; admin list "Ship to" column, satisfies **AC-9**, **AC-12**, **AC-13**
9. [x] DB tests in `tests/db/`: order row holds address and fee, total CHECK holds, settings read in transaction wins over a changed cache, prefill picks the newest order of the cart only, satisfies **AC-5**, **AC-7**, **AC-9**
10. [x] Playwright in `tests/e2e/checkout/` and `tests/e2e/admin/`: validation messages and focus, threshold reached shows free delivery, settings change reflected on cart, prefill after cancel, axe on every touched page, satisfies **AC-2**, **AC-4**, **AC-8**, **AC-10**, **AC-16**

## Consequences

**Positive**:
- The fee and the address are frozen on the order before any money moves, so Stripe, the order and admin always agree on the total.
- No migration: the Slice 1 schema already had the columns, which lowers the risk of this slice.
- The address schema and rule sit in `src/lib/shipping/`, ready for feature 12 (saved addresses) and feature 14 (discounts feed the rule).

**Negative / tradeoffs**:
- Seven more fields at checkout add friction compared with email only.
- No address verification: a typo in the street reaches the courier. Only format and length are checked.
- The database does not enforce the address (engineer's choice); a future code path that creates orders must use the same schema.
- Expired, never paid orders now also hold name, address and phone until a purge exists.
- One country is wired in; a second country needs a postal rule and a country selector.
- Delivery has no tax treatment yet (`tax_behavior` unspecified), consistent with tax being deferred.

**Neutral**:
- `StartCheckoutError`'s `validation` shape changes from one field to a field map; the form and its tests change with it.
- A new feature folder `src/features/settings/` and admin nav entry; later settings (store name, emails) can join the same page.

## Follow-up

- [ ] Enroll a GDPR retention slice: a cron that blanks name, address, phone (and email) on orders expired more than N days, alongside feature 16's policies.
- [ ] Your `.env.local` has `STORE_CURRENCY=EUR` while the store ships to Poland; confirm the currency (PLN is usual) before launch, since it changes the Stripe minimum and price display.
- [ ] When tax lands, set `tax_behavior` and the shipping tax code on the Stripe shipping rate.
- [ ] Feature 12 should reuse `shippingAddressSchema` for saved addresses and prefill from the default address before the cart's last order.
