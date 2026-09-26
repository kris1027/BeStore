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
| 6 | Core buy loop | Slice 1 | in-progress |
| 7 | Card payment & paid orders | Slice 1 | planned |
| 8 | Shipping address & flat rate | Slice 2 | planned |
| 9 | Admin catalog management | Slice 3 | planned |
| 10 | Admin order management | Slice 4 | planned |
| 11 | Order emails | Slice 5 | planned |
| 12 | Customer accounts | Slice 6 | planned |
| 13 | Categories, search & filters | Slice 7 | planned |
| 14 | Discounts & promo codes | Slice 8 | planned |
| 15 | Admin sales dashboard | Slice 9 | planned |
| 16 | Legal pages & cookie consent | Launch | planned |
| 17 | SEO for storefront pages | Launch | planned |
| 18 | Analytics & error tracking | Launch | planned |
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

### 6. Core buy loop · in-progress
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
- [ ] Test it: `/test core buy loop`

### 7. Card payment & paid orders · needs a decision · GA
Guest card payment at checkout, confirmed on the server, turning the cart into a paid order that appears in a basic admin order list.
**Done when:** a successful payment creates exactly one paid order and reduces stock; a failed or abandoned payment creates no paid order; the order shows in admin with its lines and total; paying twice for the same cart is not possible.
- [ ] Design it (spec): `/architect card payment & paid orders`

## Slice 2: Shipping

### 8. Shipping address & flat rate
Checkout collects a delivery address and adds one flat shipping fee, free above an amount the admin sets.
**Done when:** checkout requires a valid address, the total includes the right shipping fee (or free above the threshold), and admin sees the address on the order.
- [ ] Build it: `/develop shipping address & flat rate`

## Slice 3: Catalog

### 9. Admin catalog management · needs a decision
Thicken the admin product editor: edit and hide products, manage categories, several images per product, stock per variant.
**Done when:** an admin can create, edit, hide, and reorder products and categories, upload and order several images, and change stock per variant; hidden products vanish from the storefront.
- [ ] Design it (spec): `/architect admin catalog management`

## Slice 4: Orders

### 10. Admin order management · needs a decision
Run orders after payment: filter and search orders, move them through statuses (paid, shipped, delivered, cancelled, refunded), and issue refunds.
**Done when:** an admin can find any order, change its status with a history of who changed what, and refund all or part of it through the payment provider; a refund returns stock when chosen.
- [ ] Design it (spec): `/architect admin order management`

## Slice 5: Emails

### 11. Order emails · needs a decision
Tell customers what is happening with their order.
**Done when:** customers get an order confirmation after payment and an email when the order ships or is refunded; emails are sent once, even if a step is retried.
- [ ] Design it (spec): `/architect order emails`

## Slice 6: Accounts

### 12. Customer accounts · needs a decision · GA
Optional accounts: guest checkout stays the default, customers who sign up see their order history and saved address.
**Done when:** a customer can sign up, sign in, reset a password, and see past orders; guest checkout still works; a guest can later create an account with the same email and see earlier orders.
- [ ] Design it (spec): `/architect customer accounts`

## Slice 7: Discovery

### 13. Categories, search & filters · needs a decision
Help customers find products: category pages, text search, filters by price and variant options, sorting.
**Done when:** a customer can browse by category, search by name, filter and sort results, and the URL reflects the filters so results can be shared; empty and no results states render.
- [ ] Design it (spec): `/architect categories, search & filters`

## Slice 8: Discounts

### 14. Discounts & promo codes · needs a decision · GA
Admin created promo codes (percent or fixed amount, with dates and usage limits), applied at checkout.
**Done when:** a valid code lowers the total correctly before payment; expired, used up, or invalid codes are rejected with a clear message; the discount is saved on the order and in refunds.
- [ ] Design it (spec): `/architect discounts & promo codes`

## Slice 9: Insights

### 15. Admin sales dashboard
The admin landing page: revenue, order count, average order value, and best sellers over a chosen period.
**Done when:** numbers match the orders in the database for the chosen period, refunds are subtracted, and the page loads fast with a year of orders.
- [ ] Build it: `/develop admin sales dashboard`

## Launch readiness

### 16. Legal pages & cookie consent · needs a decision
Terms, privacy policy, returns and shipping policy, and a cookie banner that blocks non essential cookies until the customer agrees.
**Done when:** the legal pages are linked from every page footer and from checkout; no analytics or marketing cookies are set before consent; the customer can change their choice later.
- [ ] Design it (spec): `/architect legal pages & cookie consent`

### 17. SEO for storefront pages
Make products findable: titles, descriptions, canonical links, sitemap, product rich results, and social share cards on every public page.
**Done when:** every product and category page has unique metadata and structured product data, the sitemap lists all visible products, hidden products and admin pages are never indexed.
- [ ] Build it: `/develop SEO for storefront pages`

### 18. Analytics & error tracking · needs a decision
See how customers move through the store and know when something breaks.
**Done when:** the funnel (view product, add to cart, start checkout, pay) is tracked with consent respected; front end and server errors, including failed payments, raise alerts.
- [ ] Design it (spec): `/architect analytics & error tracking`

### 19. Production deploy
The last step: ship to Vercel and the production Supabase project, and turn on the production only settings every earlier slice left for deploy time.
**Done when:** the production app runs on Vercel against production Supabase, and each production only item below is applied and checked there.
- [ ] Build it: `/develop production deploy`
  - [ ] Admin sign in, from the runbook [docs/runbooks/admin-accounts.md](../runbooks/admin-accounts.md): production Supabase auth settings, Resend SMTP, recovery template, redirect URLs, asymmetric JWT keys, the first real admin (spec 0004 AC-10, AC-11)
  - [ ] Vercel Firewall rate limit on `POST` to `/admin/sign-in`, `/admin/mfa`, `/admin/forgot-password`: 10 per minute per IP, deny 10 minutes (spec 0004 AC-15)
- [ ] Verify it: `/check verify production deploy`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Tax / VAT calculation**: per region tax rules; for now prices are shown tax inclusive in one country · needs a decision · GA
- **Admin roles & permissions**: owner, staff, support with different rights · needs a decision
- **Zone or weight based shipping**: rates by region or package weight · needs a decision
- **Several languages & currencies**: selling abroad · needs a decision
- **Product reviews**: customer ratings on product pages · needs a decision
- **Wishlist**: save products for later · needs a decision
- **Dark mode**: a dark token set with its own contrast pass and a theme switch; the semantic tokens rule keeps it a token change · needs a decision · from spec 0003

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
