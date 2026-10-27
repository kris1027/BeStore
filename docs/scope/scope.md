# Scope: BeStore

A single brand online store where customers browse products, add them to a cart, and pay by card (as a guest or with an optional account), plus an admin panel where a few admins run the catalog, orders, discounts, and sales stats. It sells in one country, in one language and one currency, and ships at a flat rate.

**Build approach:** Tracer Bullet (prove one real thread through every layer first, then thicken one segment at a time, each slice shipped end to end).
**Workflow:** Beta (after `/develop`: `/check verify`, then `/test`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Features that touch money or sign in carry `· GA` for an extra fresh model review.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | done |
| 2 | Coding standards & tooling | Foundation | done |
| 3 | Data model | Foundation | done |
| 4 | Design system & UI foundation | Foundation | done |
| 5 | Admin sign in | Slice 1 | done |
| 6 | Core buy loop | Slice 1 | done |
| 7 | Card payment & paid orders | Slice 1 | done |
| 20 | One Stripe session state | Slice 1 follow up | done |
| 21 | Report Stripe skill doc bugs upstream | Slice 1 follow up | done |
| 8 | Shipping address & flat rate | Slice 2 | done |
| 22 | Purge PII from expired orders | Slice 2 follow up | done |
| 9 | Admin catalog management | Slice 3 | done |
| 10 | Admin order management | Slice 4 | done |
| 11 | Order emails | Slice 5 | done |
| 12 | Customer accounts | Slice 6 | done |
| 13 | Categories, search & filters | Slice 7 | done |
| 14 | Discounts & promo codes | Slice 8 | done |
| 15 | Admin sales dashboard | Slice 9 | done |
| 23 | Native controls in GET forms | Slice 9 follow up | done |
| 16 | Legal pages & cookie consent | Launch | done |
| 17 | SEO for storefront pages | Launch | done |
| 19 | Production deploy | Launch | planned |

## Foundations

### 1. Stack & architecture · done
Decide the stack (storefront, admin, back end, database, hosting) and scaffold a runnable project so every slice builds on real structure. The storefront must be renderable for search engines, so SEO is a stack requirement from day one.
**Done when:** the stack is recorded in a spec, and the empty scaffold boots locally and passes build.
spec [0001](../specs/0001-stack-architecture/index.md) · code in [app/](../../app/), [src/](../../src/), [prisma/](../../prisma/), [supabase/](../../supabase/)
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
- [x] Verify it: `/check verify stack & architecture`
- [x] Test it: `/test stack & architecture`

### 2. Coding standards & tooling · done
Capture conventions from the real scaffolded project, then install lint, format, type checks, pre commit hooks, and CI.
**Done when:** root `AGENTS.md` reflects the real stack, and lint, format, and pre commit run clean.
code in [package.json](../../package.json), [.github/workflows/](../../.github/workflows/)
- [x] Capture conventions + tooling choices: `/audit`
- [x] Build it: `/develop tooling`
  - [x] Stricter types (`noUncheckedIndexedAccess`, no `any`)
  - [x] Prettier with Tailwind class sorting
  - [x] Pre commit hook (lint, format, typecheck)
  - [x] CI on GitHub Actions

### 3. Data model · done
Core entities every feature builds on: products, variants (size, color) with their own price and stock, categories, images, carts, orders and order lines, customers, admins, discounts, shipping settings.
**Done when:** the schema supports every planned slice (variants, guest and account orders, refunds, promo codes) without a breaking migration, and order lines keep the price paid even if the product changes later.
spec [0002](../specs/0002-data-model/index.md) · code in [prisma/](../../prisma/), [tests/db/](../../tests/db/)
- [x] Design it (spec): `/architect data model`
- [x] Build it: `/develop data model`
  - [x] Thin thread: products, variants and settings migrated, db test suite and CI Postgres running (AC-1, AC-2, AC-4, AC-9, AC-14)
  - [x] Full catalog, people and cart tables with their constraints and tests (AC-5, AC-7, AC-10)
  - [x] Orders, money and operations tables, no drift, constraint and race tests (AC-3, AC-6, AC-8, AC-11, AC-12, AC-15)
  - [x] Demo seed with the local host guard (AC-13)
- [x] Verify it: `/check verify data model`
- [x] Test it: `/test data model`

### 4. Design system & UI foundation · done
Visual language, layout, and base components shared by the storefront and the admin panel, built to WCAG AA from the start.
**Done when:** `design.md` covers type, color, spacing, and components; base components work by keyboard and screen reader and meet AA contrast.
spec [0003](../specs/0003-design-system-ui-foundation/index.md) · design [design.md](../design.md) · code in [src/components/](../../src/components/), [src/lib/brand/](../../src/lib/brand/), [app/style-guide/](../../app/style-guide/), [app/globals.css](../../app/globals.css)
- [x] Design it (spec): `/architect design system & UI foundation`
- [x] Build it: `/develop design system & UI foundation`
  - [x] Thin thread: shadcn on Base UI, brand files, fonts, `STORE_LOCALE`, first storefront shell, gated `/style-guide`, axe and Playwright in CI (AC-1, AC-5, AC-11, AC-16)
  - [x] Tokens with measured contrast, the core component set on the style guide, design lint, placeholder and reduced motion (AC-3, AC-4, AC-12, AC-14, AC-15)
  - [x] Storefront and admin shells complete, with keyboard and axe tests on desktop and phone (AC-6, AC-7, AC-8, AC-9)
  - [x] Money formatting and `Price`, error pages, and `docs/design.md` (AC-2, AC-10, AC-13)
- [x] Verify it: `/check verify design system & UI foundation`
- [x] Test it: `/test design system & UI foundation`

## Slice 1: Core buy loop (the walking skeleton)

The thinnest real thread: an admin signs in and adds a product, a customer finds it, buys it, pays, and the paid order shows up in admin. Real database, real payment, real UI, just narrow.

### 5. Admin sign in · done · GA
Only admins reach the admin panel. One role, a few admin accounts, no public sign up.
**Done when:** an admin can sign in and out; every admin page and admin action refuses anyone who is not signed in as an admin.
spec [0004](../specs/0004-admin-sign-in/index.md) · code in [src/features/admin-auth/](../../src/features/admin-auth/), [app/admin/](../../app/admin/), [scripts/admin/](../../scripts/admin/), [docs/runbooks/admin-accounts.md](../runbooks/admin-accounts.md)
- [x] Design it (spec): `/architect admin sign in`
- [x] Build it: `/develop admin sign in`
  - [x] Thin thread: Supabase clients, proxy, `admin:create`, password sign in and out, `requireAdmin()`, welcome page, real Supabase in CI e2e (AC-1, AC-2, AC-3, AC-8, AC-11)
  - [x] Required TOTP: enroll and verify, `aal2` enforcement, wrong code lockout, `admin:reset-mfa`, then denials and the 12 hour cap with `admin:disable` (AC-4, AC-5, AC-6, AC-7, AC-12, AC-16, AC-17)
  - [x] Password reset through Resend SMTP, `/auth/confirm`, TOTP before the new password (AC-9, AC-10)
  - [x] Auth event logging, keyboard and axe on every auth page, production runbook (AC-13, AC-14); the production Firewall rule (AC-15) moved to feature 19
- [x] Verify it: `/check verify admin sign in`
- [x] Test it: `/test admin sign in`
- [x] Review it (fresh model): `/check review admin sign in`
- [x] Document it: `/document admin sign in`

### 6. Core buy loop · done
The narrow end to end path: an admin creates a product with variants, price, stock, and one image; the storefront shows a product list and a product page; a customer picks a variant, adds it to a cart, and reaches checkout as a guest.
**Done when:** a product created in admin appears on the storefront; a customer can choose a variant, change quantities in the cart, and the cart survives a page reload; out of stock variants cannot be added.
spec [0005](../specs/0005-core-buy-loop/index.md) · code in [src/features/catalog/](../../src/features/catalog/), [src/features/cart/](../../src/features/cart/), [src/lib/cart/](../../src/lib/cart/), [app/(store)/](../../app/(store)/), [app/admin/(panel)/products/](../../app/admin/(panel)/products/), [src/features/checkout/](../../src/features/checkout/)
- [x] Design it (spec): `/architect core buy loop`
- [x] Build it: `/develop core buy loop`
  - [x] Thin thread: Cache Components on with the admin and auth refit (proxy admin gate with real 404s, sign out as a POST route), admin create and list for a simple product, cached home grid and product page, add to cart with the signed cookie, cart survives reload in e2e (AC-1, AC-3, AC-6, AC-8, AC-9, AC-14, AC-15, AC-19, AC-20)
  - [x] Options and variants: option types, generated variant grid, field errors, product page picker with availability (AC-2, AC-4, AC-7)
  - [x] Product image: signed upload to Storage, alt text, image config, Storage in CI (AC-5)
  - [x] Full cart and checkout stub: quantity and remove, stale line flags, header count, `/checkout` summary (AC-10, AC-11, AC-12, AC-13)
  - [x] Expired cart cron, logs, and the accessibility pass (AC-16, AC-17, AC-18)
- [x] Verify it: `/check verify core buy loop`
- [x] Test it: `/test core buy loop`

### 7. Card payment & paid orders · done · GA
Guest card payment at checkout, confirmed on the server, turning the cart into a paid order that appears in a basic admin order list.
**Done when:** a successful payment creates exactly one paid order and reduces stock; a failed or abandoned payment creates no paid order; the order shows in admin with its lines and total; paying twice for the same cart is not possible.
spec [0006](../specs/0006-card-payment-paid-orders/index.md) · code in [src/features/checkout/](../../src/features/checkout/), [src/features/orders/](../../src/features/orders/), [src/lib/orders/](../../src/lib/orders/)
- [x] Design it (spec): `/architect card payment & paid orders`
- [x] Build it: `/develop card payment & paid orders`
  - [x] Thin thread: Stripe env and client, email form and `startCheckout`, signed webhook marks one order paid and takes stock, minimal confirmation page and admin list, e2e to the Stripe redirect (AC-1, AC-3, AC-4, AC-11, AC-12, AC-14, AC-19)
  - [x] Every webhook path once and only once: duplicates, delayed and failed payments, expiry, stock shortfall, amount mismatch, foreign events, rollback on error (AC-5, AC-6, AC-7, AC-8, AC-16)
  - [x] Checkout guards and paying twice: restart through Stripe, concurrent submits, minimum charge, form errors, cancel notice (AC-2, AC-9, AC-10)
  - [x] Customer and admin views complete: every confirmation state, admin list views and paging, order detail with events (AC-11, AC-12, AC-13, AC-14)
  - [x] Safety net, logs and accessibility: daily reconcile cron, log events without emails, keyboard and axe, local full Stripe flow (AC-15, AC-17, AC-18, AC-6)
- [x] Verify it: `/check verify card payment & paid orders`
- [x] Test it: `/test card payment & paid orders`
- [x] Review it (fresh model): `/check review card payment & paid orders`
- [x] Document it: `/document card payment & paid orders`

## Slice 1 follow ups (from the review of feature 7)

### 20. One Stripe session state · done
Replace the three places that each work out what a Checkout Session's `status` and `payment_status` mean (`src/features/checkout/queries.ts`, `src/features/orders/reconcile.ts`, `src/features/checkout/actions/start-checkout.ts`, overlapping `decideEvent` in `src/features/orders/event-decision.ts`) with one shared pure function, shipped as its own PR. from spec 0006
**Done when:** every caller reads the session through the one function, it has unit tests for each status and payment status pair, and every existing checkout, webhook and reconcile test still passes unchanged.
spec [0006](../specs/0006-card-payment-paid-orders/index.md) · code in [src/lib/orders/session-state.ts](../../src/lib/orders/session-state.ts)
- [x] Build it: `/develop one Stripe session state`
- [x] Review it (fresh model): `/check review one Stripe session state`

### 21. Report Stripe skill doc bugs upstream · done · Prototype
The vendored `stripe-best-practices` skill has broken `docs.stripe.com/undefined.md` links in `references/tax.md` (lines 23, 38, 41, 57, 87) and a v2 Financial Accounts endpoint in `references/treasury.md` (line 10) that CodeRabbit says is wrong. A local fix would be overwritten on update, so it goes to the source.
**Done when:** an issue on `stripe/ai` lists the broken links and the endpoint question, and its link is noted here.
issue [stripe/ai#554](https://github.com/stripe/ai/issues/554)
- [x] Report it: open an issue on `stripe/ai` (`gh issue create --repo stripe/ai`)

## Slice 2: Shipping

### 8. Shipping address & flat rate · done
Checkout collects a delivery address and adds one flat shipping fee, free above an amount the admin sets.
**Done when:** checkout requires a valid address, the total includes the right shipping fee (or free above the threshold), and admin sees the address on the order.
spec [0007](../specs/0007-shipping-address-flat-rate/index.md) · code in `src/lib/shipping/`, `src/features/checkout/`, `src/features/settings/`
- [x] Design it (spec): `/architect shipping address & flat rate`
- [x] Build it: `/develop shipping address & flat rate`
  - [x] Thin thread: `STORE_COUNTRY`, the pure shipping rule and address schema, fee read in the order transaction, address saved on the order, Stripe shipping option and payment intent shipping, address fields on checkout and the address on the admin order page (AC-1, AC-2, AC-3, AC-5, AC-6, AC-11, AC-14, AC-15)
  - [x] Delivery shown everywhere a total is: checkout summary and Pay button, cart delivery row and free delivery nudge (AC-4, AC-8)
  - [x] Admin settings page: fee and free delivery threshold, cache tag expiry, change log (AC-10, AC-14)
  - [x] Prefill after cancel, confirmation page delivery and address, admin list Ship to column (AC-9, AC-12, AC-13)
  - [x] Safety net: DB tests for the order row and settings race, e2e for validation, threshold, settings and prefill, axe on every touched page (AC-2, AC-4, AC-7, AC-8, AC-10, AC-16)
- [x] Verify it: `/check verify shipping address & flat rate`
- [x] Test it: `/test shipping address & flat rate`
- [x] Review it (fresh model): `/check review shipping address & flat rate`

## Slice 2 follow ups (from spec 0007)

### 22. Purge PII from expired orders · done
Orders that expire without payment keep the customer's name, address, phone and email. A daily cron blanks them once an order has been expired for a set number of days, in line with the privacy policy from feature 16. from spec 0007
**Done when:** orders expired longer than the retention period hold no name, address, phone or email, paid orders are never touched, and the cron refuses calls without `CRON_SECRET`.
spec [0008](../specs/0008-purge-expired-order-pii/index.md) · code in `src/features/orders/`
- [x] Design it (spec): `/architect purge PII from expired orders`
- [x] Build it: `/develop purge PII from expired orders`
  - [x] Migration (nullable email, `pii_purged_at`, CHECKs, partial index) and the nullable email ripple through readers and fixtures (AC-3, AC-9)
  - [x] Purge function, cron route, `vercel.json` schedule and logs (AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-10)
  - [x] Admin list and detail show "Personal data removed" (AC-8)
  - [x] Safety net: DB tests for the purge, guards, overlap and failure; e2e with axe for a purged order (AC-1 to AC-9)
- [x] Verify it: `/check verify purge PII from expired orders`
- [x] Test it: `/test purge PII from expired orders`

## Slice 3: Catalog

### 9. Admin catalog management · done
Thicken the admin product editor: edit and hide products, manage categories, several images per product, stock per variant.
**Done when:** an admin can create, edit, hide, and reorder products and categories, upload and order several images, and change stock per variant; hidden products vanish from the storefront.
spec [0009](../specs/0009-admin-catalog-management/index.md) · code in `src/features/catalog/`, `src/features/categories/`
- [x] Design it (spec): `/architect admin catalog management`
- [x] Build it: `/develop admin catalog management`
  - [x] Thin thread: edit page Details section, publish, hide, archive and restore with cache expiry and list status tabs (AC-2, AC-3, AC-5, AC-21, AC-22, AC-23, AC-24)
  - [x] Variants, stock and history: `stock_movements` migration and backfill, sale rows from `takeStock`, Stock section with compare and set, Variants section, add option value, sale price on the storefront (AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-16)
  - [x] Images and Markdown: shared keyboard sortable list, up to 8 images with option links, gallery and order photo rule, file cleanup, Markdown with preview (AC-6, AC-13, AC-14, AC-15)
  - [x] Categories, arranging, list and delete: category pages and actions, assignment from both sides, arrange products and categories, list search, filters and paging, delete with checkout lock (AC-1, AC-4, AC-17, AC-18, AC-19, AC-20)
  - [x] Safety net: DB tests for every conflict and guard, e2e with axe and keyboard on every touched page (AC-1 to AC-25)
- [x] Verify it: `/check verify admin catalog management`
- [x] Test it: `/test admin catalog management`
- [x] Review it (fresh model): `/check review admin catalog management`

## Slice 4: Orders

### 10. Admin order management · done
Run orders after payment: filter and search orders, move them through statuses (paid, shipped, delivered, cancelled, refunded), and issue refunds.
**Done when:** an admin can find any order, change its status with a history of who changed what, and refund all or part of it through the payment provider; a refund returns stock when chosen.
spec [0010](../specs/0010-admin-order-management/index.md) · code in [src/features/orders/](../../src/features/orders/), [src/lib/orders/](../../src/lib/orders/), [app/admin/(panel)/orders/](../../app/admin/(panel)/orders/), [prisma/migrations/](../../prisma/migrations/)
- [x] Design it (spec): `/architect admin order management`
- [x] Build it: `/develop admin order management`
  - [x] Thin thread and status actions: migrations, mark shipped, delivered, undo, edit tracking, notes, resolve attention, history (AC-4 to AC-8, AC-19 to AC-22)
  - [x] Refunds and cancel: refund math, reserve then Stripe then settle, per line restock, cancel paid and unpaid (AC-9 to AC-15, AC-18)
  - [x] Stripe side refunds and sync: `refund.*` webhook events, the refund outcomes table, sync in the reconcile cron and "Check with Stripe" (AC-16, AC-17)
  - [x] Finding orders: search, status, attention, refund state and date filters with paging (AC-1 to AC-3)
  - [x] Safety net: log redaction, keyboard and axe, e2e (refund and cancel under `STRIPE_E2E=1`) (AC-23, AC-24)
- [x] Verify it: `/check verify admin order management`
- [x] Test it: `/test admin order management`
- [x] Review it (fresh model): `/check review admin order management`

## Slice 5: Emails

### 11. Order emails · done
Tell customers what is happening with their order.
**Done when:** customers get an order confirmation after payment and an email when the order ships or is refunded; emails are sent once, even if a step is retried.
spec [0011](../specs/0011-order-emails/index.md) · code in [src/lib/email/](../../src/lib/email/), [emails/](../../emails/), [src/features/orders/](../../src/features/orders/), [prisma/migrations/](../../prisma/migrations/)
- [x] Design it (spec): `/architect order emails`
- [x] Build it: `/develop order emails`
  - [x] Thin thread: migration, env and transports, the outbox, one confirmation email sent from the paid webhook (AC-1, AC-8, AC-10, AC-16)
  - [x] All three emails: full confirmation layout and content, shipped, refunds with frozen cancel wording (AC-2 to AC-7, AC-18)
  - [x] Failure handling: error sorting, in process retry, daily sweep in the reconcile cron, give up and flag, missing email (AC-9, AC-11, AC-12)
  - [x] Admin Emails section and Send again, logs, e2e with axe (AC-13 to AC-15, AC-17, AC-18)
- [x] Verify it: `/check verify order emails`
- [x] Test it: `/test order emails`

## Slice 6: Accounts

### 12. Customer accounts · done · GA
Optional accounts: guest checkout stays the default, customers who sign up see their order history and saved address.
**Done when:** a customer can sign up, sign in, reset a password, and see past orders; guest checkout still works; a guest can later create an account with the same email and see earlier orders.
spec [0012](../specs/0012-customer-accounts/index.md) · code in [src/features/account/](../../src/features/account/), [src/lib/customer/](../../src/lib/customer/), [src/lib/cart/merge.ts](../../src/lib/cart/merge.ts), [src/lib/email/](../../src/lib/email/), [emails/](../../emails/), [app/(store)/account/](../../app/(store)/account/)
- [x] Design it (spec): `/architect customer accounts`
- [x] Build it: `/develop customer accounts`
  - [x] Thin thread: config, the Send Email Hook, Mailpit transport, sign up, confirm, choose password, account setup and a bare order list (AC-1 to AC-3, AC-10, AC-11, AC-13, AC-22, AC-23)
  - [x] Sign in, sign out, cart merge and password reset through the hook (AC-4 to AC-9)
  - [x] Account area: order history and detail, address book (AC-11 to AC-14)
  - [x] Checkout integration, settings, delete account and the admin badge (AC-15 to AC-21)
  - [x] Safety net: logs, axe, header link, production runbook (AC-22, AC-24 to AC-26)
  - [x] Review follow ups: account cart usable only by its owner's session, the merge count, the admin guard on the confirm password replace (AC-2, AC-5, AC-7, AC-24)
- [x] Verify it: `/check verify customer accounts`
- [x] Test it: `/test customer accounts`
- [x] Review it (fresh model): `/check review customer accounts`
- [x] Document it: `/document customer accounts`

## Slice 7: Discovery

### 13. Categories, search & filters · done
Help customers find products: category pages, text search, filters by price and variant options, sorting.
**Done when:** a customer can browse by category, search by name, filter and sort results, and the URL reflects the filters so results can be shared; empty and no results states render.
spec [0013](../specs/0013-categories-search-filters/index.md) · code in [src/features/catalog/listing/](../../src/features/catalog/listing/), [src/features/categories/](../../src/features/categories/)
- [x] Design it (spec): `/architect categories, search & filters`
- [x] Build it: `/develop categories, search & filters`
  - [x] Thin thread: `categories` cache tag and its expiry, the cached listing index, header nav, category pages with paging, not found and empty states (AC-1 to AC-3, AC-5, AC-22)
  - [x] Home and search: home becomes the full listing, text folding, the header search box, `/search` with Best match and the short query prompt (AC-4, AC-6 to AC-10)
  - [x] Filters and sort: option groups and counts, per variant matching, price, stock and sale, URL repair and serialization, sort, the panel, Sheet, chips and no results states (AC-11 to AC-21)
  - [x] Admin arrange inside a category (AC-23)
  - [x] Safety net: category metadata and canonicals, e2e with axe and keyboard on home, category and search (AC-1 to AC-25)
- [x] Verify it: `/check verify categories, search & filters`
- [x] Test it: `/test categories, search & filters`

## Slice 8: Discounts

### 14. Discounts & promo codes · done · GA
Admin created promo codes (percent or fixed amount, with dates and usage limits), applied at checkout.
**Done when:** a valid code lowers the total correctly before payment; expired, used up, or invalid codes are rejected with a clear message; the discount is saved on the order and in refunds.
Spec: [0014](../specs/0014-discounts-promo-codes/index.md) · code in [src/features/discounts/](../../src/features/discounts/), [src/lib/discounts/](../../src/lib/discounts/)
- [x] Design it (spec): `/architect discounts & promo codes`
- [x] Build it: `/develop discounts & promo codes`
  - [x] Thin thread: migration, the pure discount rule and split, code lock, counts and redemption lifecycle, admin create, Apply and Pay with the Stripe coupon, the admin order row, e2e through Stripe test mode (AC-1, AC-2, AC-4 to AC-8, AC-11, AC-14, AC-17, AC-19)
  - [x] Refusals and prefill: every refusal message on Apply and Pay, focus and live region, coupon failure, logs, returning to checkout with the code (AC-1, AC-3, AC-4, AC-7, AC-9, AC-18)
  - [x] Admin list, edit, delete and the orders filter: uses, discount given, status, search, edit lock, stale check, delete refusal, nav (AC-10, AC-12 to AC-14, AC-17, AC-18)
  - [x] Customer views and safety net: code on the complete page, account order page and email, refund check, e2e with axe and keyboard (AC-15, AC-16, AC-20)
- [x] Verify it: `/check verify discounts & promo codes`
- [x] Test it: `/test discounts & promo codes`
- [x] Review it (fresh model): `/check review discounts & promo codes`
- [x] Document it: `/document discounts & promo codes`

## Slice 9: Insights

### 15. Admin sales dashboard · done
The admin landing page: revenue, order count, average order value, and best sellers over a chosen period.
**Done when:** numbers match the orders in the database for the chosen period, refunds are subtracted, and the page loads fast with a year of orders.
Spec: [0015](../specs/0015-admin-sales-dashboard/index.md) · code in [src/features/dashboard/](../../src/features/dashboard/)
- [x] Design it (spec): `/architect admin sales dashboard`
- [x] Build it: `/develop admin sales dashboard`
  - [x] Thin thread: store day helper, default period, live totals, the four cards on `/admin`, the Dashboard nav item, skeletons and failure logging (AC-1, AC-2, AC-5 to AC-8, AC-14)
  - [x] Period picker and comparison: presets, custom range with clamp and fallback, previous window, change text, currency notice (AC-2 to AC-4, AC-7, AC-10)
  - [x] Best sellers and chart: the top 10 table, shadcn Chart with day, week and month buckets, the table toggle (AC-8, AC-9, AC-11, AC-12)
  - [x] Orders link and safety net: `dates=paid` on the orders list, the seeded year speed and exactness test, e2e with axe and keyboard (AC-13, AC-15, AC-16)
- [x] Verify it: `/check verify admin sales dashboard`
- [x] Test it: `/test admin sales dashboard`

## Slice 9 follow ups (from spec 0016)

### 23. Native controls in GET forms · done
Every filter, period picker and search box uses native controls (`NativeSelect`, native checkbox and radio) and a submit button, so it works before the app's JavaScript loads. The admin orders, discounts and products filters move off the Base UI Select and Checkbox, and the hand rolled selects move to `NativeSelect`. from spec 0016
**Done when:** no GET form uses a Base UI control, ESLint bans `@/components/ui/select` outside the style guide, and every GET form has a passing e2e test with the app's scripts blocked.
spec [0016](../specs/0016-native-controls-get-forms.md) · code in [src/components/ui/native-select.tsx](../../src/components/ui/native-select.tsx)
- [x] Design it (spec): `/architect native controls in GET forms`
- [x] Build it: `/develop native controls in GET forms`
  - [x] `NativeSelect` from the shadcn registry, with its states on `/style-guide`
  - [x] Move the orders, discounts, products, dashboard, sort and checkout country controls to native ones, with the e2e steps that open them updated
  - [x] `blockAppScripts` helper and one no JavaScript e2e test per GET form, then the ESLint ban
- [x] Verify it: `/check verify native controls in GET forms`
- [x] Test it: `/test native controls in GET forms`

## Launch readiness

### 16. Legal pages & cookie consent · done
Terms, privacy policy, returns and shipping policy, and a cookie banner that blocks non essential cookies until the customer agrees.
**Done when:** the legal pages are linked from every page footer and from checkout; no analytics or marketing cookies are set before consent; the customer can change their choice later.
spec [0017](../specs/0017-legal-pages-cookie-consent/index.md) · code in [src/lib/legal/](../../src/lib/legal/), [src/lib/consent/](../../src/lib/consent/), [src/features/legal/](../../src/features/legal/)
- [x] Design it (spec): `/architect legal pages & cookie consent`
- [x] Build it: `/develop legal pages & cookie consent`
  - [x] Thin thread: the terms page from Markdown, the footer link, the checkout checkbox recording the version on the order, the admin line and the confirmation email (AC-1, AC-2, AC-4, AC-7 to AC-11, AC-13, AC-14)
  - [x] The other four pages with live shipping values, the model withdrawal form, print styles and the sign up notice (AC-1 to AC-3, AC-5 to AC-7, AC-12)
  - [x] Consent core: the cookie, the registry, `ConsentProvider`, `useConsent` and `ConsentGate`, and the cookie table (AC-15, AC-17, AC-22)
  - [x] Banner, settings dialog, withdrawal, GPC, the style guide demo and the first visit privacy e2e (AC-16, AC-18 to AC-21, AC-23, AC-24)
- [x] Verify it: `/check verify legal pages & cookie consent`
- [x] Test it: `/test legal pages & cookie consent`

### 17. SEO for storefront pages · done
Make products findable: titles, descriptions, canonical links, sitemap, product rich results, and social share cards on every public page.
**Done when:** every product and category page has unique metadata and structured product data, the sitemap lists all visible products, hidden products and admin pages are never indexed.
spec [0018](../specs/0018-storefront-seo/index.md) · code in [src/lib/seo/](../../src/lib/seo/), [src/features/catalog/seo.ts](../../src/features/catalog/seo.ts), [app/sitemap.ts](../../app/sitemap.ts), [app/robots.ts](../../app/robots.ts)
- [x] Design it (spec): `/architect SEO for storefront pages`
- [x] Build it: `/develop SEO for storefront pages`
  - [x] Thin thread: `metadataBase`, the shared metadata helper, full product metadata and Product JSON-LD with Offers and shipping, a products only sitemap, robots with the production rule (AC-1, AC-2, AC-5 to AC-11, AC-20)
  - [x] Brand card, logo and icon; home, legal and search pages on the helper; Organization and WebSite JSON-LD (AC-3, AC-4, AC-15, AC-17)
  - [x] Listing canonicals and paged titles, category descriptions and BreadcrumbList (AC-12 to AC-14, AC-16)
  - [x] Full sitemap (home, legal, categories, images) and the hidden and private page checks (AC-18, AC-19, AC-21, AC-22)
- [x] Verify it: `/check verify SEO for storefront pages` (the Rich Results Test waits for the first preview deploy, a spec 0018 follow-up)
- [x] Test it: `/test SEO for storefront pages`

### 19. Production deploy
The last step: ship to Vercel and the production Supabase project, and turn on the production only settings every earlier slice left for deploy time.
**Done when:** the production app runs on Vercel against production Supabase, and each production only item below is applied and checked there.
- [ ] Build it: `/develop production deploy`
  - [ ] Admin sign in, from the runbook [docs/runbooks/admin-accounts.md](../runbooks/admin-accounts.md): production Supabase auth settings, Resend SMTP, recovery template, redirect URLs, asymmetric JWT keys, the first real admin (spec 0004 AC-10, AC-11)
  - [ ] Vercel Firewall rate limit on `POST` to `/admin/sign-in`, `/admin/mfa`, `/admin/forgot-password`: 10 per minute per IP, deny 10 minutes (spec 0004 AC-15)
  - [ ] Vercel Firewall rate limit on `POST /checkout` (promo code Apply and Pay), generous enough for real Pay clicks (spec 0014 Follow-up)
- [ ] Verify it: `/check verify production deploy`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Tax / VAT calculation**: per region tax rules; for now prices are shown tax inclusive in one country · needs a decision · GA
- **Admin roles & permissions**: owner, staff, support with different rights · needs a decision
- **Zone or weight based shipping**: rates by region or package weight · needs a decision
- **Several languages & currencies**: selling abroad · needs a decision
- **Product reviews**: customer ratings on product pages · needs a decision
- **Wishlist**: save products for later · needs a decision
- **Return window and delivery time as data**: real values so the product Offer can carry `hasMerchantReturnPolicy` and `deliveryTime` · from spec 0018
- **Dark mode**: a dark token set with its own contrast pass and a theme switch; the semantic tokens rule keeps it a token change · needs a decision · from spec 0003
- **Sweep abandoned product image uploads**: delete files in `product-images` that no image row and no order line references, older than a day, if storage cost grows · from spec 0009
- **Storefront listing in SQL**: move search, filters and counts from the cached in memory index to SQL per request (`pg_trgm`, `unaccent`) once the catalog passes about 2,000 active products or the index nears the cache entry limit · needs a decision · from spec 0013
- **Trigram search indexes for admin orders**: `pg_trgm` indexes on the searched order columns, once the list is measured as slow · from spec 0010
- **Redact customer data at Stripe**: remove the name, email and address Stripe keeps on expired Checkout Sessions, if its redaction tooling fits · needs a decision · from spec 0008
- **Resend bounce and complaint webhooks**: record bounced and complained on `email_sends` and show "Bounced" on the order page, once live · from spec 0011
- **Email sweep on its own 10 minute cron**: when the project moves to Vercel Pro (feature 19) · from spec 0011
- **Customer email change**: Supabase secure email change, keeping `customers.email` and order linking in step · needs a decision · from spec 0012
- **Order data retention and export**: set the accounting retention period, extend the spec 0008 purge to settled orders past it, and offer account holders a data export · needs a decision · GA · from spec 0012
- **Admin customers page**: search customers and see their orders, if support needs it · needs a decision · from spec 0012
- **Analytics & error tracking (feature 18)**: the consent respected funnel (view product, add to cart, start checkout, pay) and alerts on front end, server and payment errors · needs a decision

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading (e.g. `· GA`) sets that one feature's rigor above or below the project default; no tag inherits the default. It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
