# 0005. Core buy loop: admin product create, storefront catalog and guest cart

**Date**: 2026-09-26
**Status**: In Progress

## Summary

This spec builds the first real path through the store: an admin creates a product with its options (size, color), variants, prices, stock and one optional image; the product shows on the home page grid and on its own product page; a customer picks a variant, adds it to a cart, edits the cart, and reaches a checkout summary page (payment is feature 7). Catalog pages are served from a static cache and refreshed the moment an admin saves, using Next.js 16 Cache Components (a mode where the page shell is prebuilt and only the per visitor parts, like the cart count, stream in). The cart lives in Postgres, found through a signed cookie, and the server always checks price and stock, never trusting the browser. Because Cache Components streams a static shell before a page can fail, the admin gate moves its denial into the proxy (so non admins still get a real 404 status), and sign out becomes a plain form POST to a route handler, so the browser does a full page load and keeps no admin page alive.

## Requirements

**User stories**:
- As an admin, I want to create a product with its options, variants, prices, stock and a photo, and choose whether it goes live, so I can put things on sale without touching the database.
- As a customer, I want to see what is for sale, choose the exact size or color I want, and know whether it is in stock, so I can decide to buy.
- As a customer, I want my cart to keep what I added, even after a reload, and to tell me plainly when something is no longer available, so I never reach payment with a cart that cannot be fulfilled.

**Acceptance criteria**:
- **AC-1**: The admin nav has a "Products" entry. `/admin/products` lists up to 200 products, newest first, with name, status, variant count, total stock, price (a range when variant prices differ) and created date (in `STORE_TIMEZONE`), plus a "New product" button; with no products it shows an Empty state with that button.
- **AC-2**: `/admin/products/new` collects name, slug, description and up to 3 option types, each with 1 to 10 values. From them the form generates one variant row per combination (option type order, then value order) with price, stock and SKU; with no option types it shows exactly one default variant row. More than 100 combinations is refused with a message. Rows are keyed by their combination: adding or removing an option value adds or removes only the affected rows, and every other row keeps what the admin typed. The slug is prefilled from the name and the SKU of each row from the slug and its values (uppercased); the admin may edit both.
- **AC-3**: "Save as draft" or "Publish" creates the product (status `draft` or `active`), its option types, values, variants (with `option_key`), `variant_option_values` and the optional image row in one transaction, then returns to `/admin/products` with a success toast. A published product appears on `/` and at `/products/<slug>` on the very next request; a draft appears in neither (its product page is a 404).
- **AC-4**: Invalid input never crashes and never partly saves: a duplicate slug or SKU (inside the form or already in the database), a malformed slug, a price below one minor unit or with more decimals than the currency allows, a stock outside 0 to 999999, a duplicate option type name or value (case insensitive) each come back as a message on the field concerned. Prices are typed in major units (`19.99`) and converted to integer cents without floating point math.
- **AC-5**: One image is optional. The admin picks a PNG, JPEG, WebP or AVIF file of at most 10 MiB; the browser uploads it straight to the `product-images` bucket through a signed upload URL that only an admin can obtain, at a fresh path `products/<uuid>.<ext>` (Supabase's default 2 hour token, `upsert: false`, so an existing object is never overwritten). When an image is attached, alt text is required. The create action refuses an image path that does not match that pattern or does not exist in the bucket.
- **AC-6**: `/` shows up to 48 `active` products ordered by `position`, then newest first. Each card shows the first image (or `/placeholder.svg`) in the 4:5 box, the name, the price ("From €X" when variant prices differ), and a "Sold out" badge when every non archived variant has 0 stock. With no active products it shows an Empty state. The page is served from the cache: no database query runs for a repeat visit until a tag is expired.
- **AC-7**: `/products/<slug>` renders only an `active` product (unknown, `draft` or `archived` returns the 404 page). (The 404 status is not guaranteed here: the static shell streams first, so a slug that is not an active product gets the branded 404 page with status 200 and Next.js's automatic `noindex`.) It shows the name as the page `h1`, the image, the description, the price, an availability label ("In stock", "Only N left" at 5 or fewer, "Sold out"), a quantity field (accepts 1 to `lineCap(stock)` of the selected variant; the server cap stays authoritative) and an "Add to cart" button. A product with options shows one radio group per option type; a value that leads only to missing or sold out combinations stays visible, is disabled and says "sold out" in text (not by color alone). The first in stock variant (by position) is selected at load, else the first variant; changing the selection updates price and availability. A product with only a default variant shows no picker. Exact stock counts above 5 never reach the browser.
- **AC-8**: "Add to cart" sends only a variant id and a quantity. The first add creates a cart and sets the cart cookie; later adds to the same variant increase the existing line. A line never exceeds the variant's stock or 10; when the request asks for more, the line is set to the allowed maximum and the customer sees "Only N available". A sold out or archived variant, or a product that is not `active`, returns an error and writes nothing. Success shows a toast with a "View cart" link, and the header count updates.
- **AC-9**: The cart cookie holds `<cartId>.<signature>` (HMAC SHA 256 with `CART_COOKIE_SECRET`), is `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, and lives 30 days, renewed on every cart write together with `carts.expires_at`. A cookie with a bad signature, an unknown cart, or a cart past `expires_at` is treated as no cart (never an error page); the next add creates a new cart and replaces the cookie.
- **AC-10**: `/cart` lists each line with image, product name, variant label, live unit price, a quantity control, a remove button and the line total, then the subtotal and a "Checkout" button. Quantity changes and removals persist and survive a reload; the same caps and message as AC-8 apply. An empty cart shows an Empty state linking to `/`.
- **AC-11**: A line whose variant is archived, whose product is no longer `active`, which is sold out, or whose quantity exceeds current stock is flagged in text ("No longer available", "Sold out", "Only N left") with a one click fix (remove, or set to N). When several apply, only the first in this order shows: unavailable, sold out, only N left. While any line is flagged, "Checkout" is disabled with a message saying why. Rendering the cart never writes to the database.
- **AC-12**: Every storefront page shows a cart link in the header with the total quantity (accessible name like "Cart, 3 items"; no number when empty). The count streams in behind a Suspense boundary, so the catalog pages stay in the static shell.
- **AC-13**: `/checkout` rereads the cart on the server: with no cart or no lines it redirects to `/cart`; with any flagged line it redirects to `/cart`; otherwise it shows the lines and subtotal from current database prices and a notice that payment comes next. `/cart` and `/checkout` send `robots: noindex`.
- **AC-14**: `cacheComponents` is on. Catalog reads are `'use cache'` functions tagged `catalog` (the list) and `product:<slug>` (one product); the create action expires both with `updateTag`. `pnpm build` succeeds against an empty database, and every existing admin, auth, style guide and storefront e2e test still passes.
- **AC-15**: Every `/admin/products` page and both catalog admin actions call `requireAdmin()` first; a visitor who is not an admin gets the existing 404. Storefront actions never accept a price; every price comes from the database. A cart line action only touches lines of the cart named by the verified cookie; a line id from another cart is answered as not found.
- **AC-16**: `GET /api/cron/expired-carts` with `Authorization: Bearer ${CRON_SECRET}` deletes carts whose `expires_at` is in the past, in batches of 1000 until a batch deletes nothing, and returns the total deleted; a missing or wrong header gets 401 and deletes nothing. `vercel.json` schedules it daily.
- **AC-17**: axe reports no violations on `/`, a product page (with and without options), `/cart` (filled, flagged and empty), `/checkout`, `/admin/products` and `/admin/products/new` (including error states), on desktop and phone. The picker, quantity controls and the create form work by keyboard alone, and cart changes are announced to screen readers.
- **AC-18**: The app logs `catalog.product.created` (admin id, product id, status), `cart.cookie.invalid` (warn, without the cookie value) and `cron.expired_carts` (deleted count) through pino; no customer data is logged.
- **AC-19**: With Cache Components on, spec 0004's admin denials keep real HTTP statuses. For any `/admin` page request with a valid session (other than `/admin/sign-in`, `/admin/forgot-password` and `/admin/sign-out`), the proxy reads the caller's `admin_users` row and runs the same `decideAdminAccess()` that `requireAdmin()` uses: a user with no row or a disabled row gets the branded store 404 with **status 404** and the title "Page not found · <store name>"; an `aal1` session gets a real redirect to `mfaPath(<requested path and query>)`, so a deep link still lands where the admin meant after the code (except on the pages that allow `aal1`, today only `/admin/mfa`). The same verdict applies to every GET to a gated path, whatever its `rsc` or prefetch headers. If the `admin_users` lookup fails, the proxy fails open: it lets the request through, logs `auth.proxy.lookup_failed` (warn), and `requireAdmin()` still refuses. The proxy can only deny or redirect earlier, never grant: every page, action and route handler still calls `requireAdmin()`. Every existing test in `tests/e2e/admin/denials.spec.ts` passes unchanged.
- **AC-20**: Sign out (the user menu item and the MFA page button) is a plain HTML form that POSTs to `/admin/sign-out`, a route handler. It refuses a request whose `Origin` header is missing or differs from the request's own origin (403, nothing signed out); otherwise it ends the session on this device (`scope: 'local'`), logs `auth.sign_out`, and answers 303 to `/admin/sign-in?reason=signed_out` with `Cache-Control: no-store`. Only POST is exported, so a GET gets Next's 405 and never signs out. In the user menu the form sits outside the menu popup and the menu item's click calls `form.requestSubmit()`, so closing the menu cannot cancel the submit; the MFA page button is a plain submit button. It works without JavaScript (the MFA page) and from any session state (`aal1`, expired, disabled). Because it is a full document load, pressing Back afterwards shows no admin content (spec 0004 AC-8); the existing sign in e2e test passes unchanged.

## Decision

**Chosen option**: Option 1: Cache Components catalog, server action cart in Postgres, admin create in one transaction

Turn on Cache Components; serve the home grid and product pages from tagged `'use cache'` reads expired by the admin action; keep the cart as a Postgres row found through an HMAC signed cookie, changed only by server actions that read price and stock from the database; let the header count and the cart and checkout pages stream in as request time parts.

**Implementation skills**: `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `accessibility` (`.agents/skills/accessibility/`) · `playwright-best-practices` (`.agents/skills/playwright-best-practices/`) · `next-dev-loop` (`.agents/skills/next-dev-loop/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

| Path | Holds |
|---|---|
| `src/features/catalog/` | admin create: `schemas.ts` (Zod), `actions/create-product.ts`, `actions/create-image-upload.ts`, `variant-grid.ts` (pure: combinations, `option_key`, SKU and slug suggestions), admin list and form components; storefront: `queries.ts` (`'use cache'` reads), product grid, product page and picker components |
| `src/features/cart/` | `actions.ts` (`addToCart`, `setCartItemQuantity`, `removeCartItem`), cart page components, `CartLink` header badge |
| `src/features/checkout/` | the `/checkout` summary page component (feature 7 grows it) |
| `src/lib/cart/` | shared by cart, checkout (7) and accounts (12): `cookie.ts` (sign, verify, set), `load-cart.ts` (`server-only`: read the cart named by the cookie, with live variant data), `cart-lines.ts` (pure: flag each line, compute subtotal, `canCheckout`) |
| `src/lib/availability.ts` | pure: `LOW_STOCK_THRESHOLD = 5`, `MAX_LINE_QUANTITY = 10`, `availability(stock)` → `in_stock` · `low(n)` · `sold_out`, `lineCap(stock)` |
| `src/lib/variant-label.ts` | pure: option values ordered by option type position, joined with ` / ` (spec 0002 uses the same rule for order line snapshots) |
| `src/lib/cache-tags.ts` | `catalogTag = "catalog"`, `productTag(slug)`; the contract feature 7 and 9 use to expire catalog pages |
| `src/lib/money.ts` (exists) | adds `parseMoney(text, currency)`: string based, reads the currency's fraction digits from `Intl`, rejects extra decimals |
| `src/lib/slug.ts` | pure `slugify(name)` |
| `src/lib/product-image.ts` | `productImageUrl(path)` (public bucket URL), allowed types and size limit |
| `src/lib/supabase/admin.ts` | `server-only` service role client for Storage (signed upload URLs, existence checks) |
| `app/admin/(panel)/products/page.tsx`, `new/page.tsx` | thin admin routes |
| `app/(store)/page.tsx`, `products/[slug]/page.tsx`, `cart/page.tsx`, `checkout/page.tsx` | thin storefront routes |
| `app/api/cron/expired-carts/route.ts` | the cron handler |
| `src/features/admin-auth/proxy.ts`, `proxy-decision.ts` (exist) | the proxy gains the admin row lookup and runs `decideAdminAccess()` (AC-19); `/admin/sign-out` joins the paths it lets through untouched |
| `app/admin/sign-out/route.ts` | the sign out route handler (AC-20); it replaces the `signOut` server action, which is deleted |

### Data model sketch

No migration. Every table and constraint exists from spec 0002; this slice only writes and reads them.

| Table | Written or read here | Keys and links |
|---|---|---|
| `products` | name, slug, description (plain text for now), status `draft` or `active`; `position` stays 0 | PK id; slug unique |
| `product_option_types` | 0 to 3 per product; name, position | FK product_id (N:1); unique (product_id, name) |
| `product_option_values` | 1 to 10 per type; value, position | FK option_type_id (N:1); unique (option_type_id, value) |
| `product_variants` | one per combination; sku, price_cents, stock_quantity, position, option_key; `compare_at_price_cents` stays null | FK product_id (N:1); sku unique; unique (product_id, option_key) |
| `variant_option_values` | one row per variant per option type | PK (variant_id, option_value_id) |
| `product_images` | 0 or 1 row: storage_path, alt_text, width, height, position 0, `option_value_id` null | FK product_id (N:1); storage_path unique |
| `carts` | created on first add; `customer_id` null; expires_at | PK id (in the cookie) |
| `cart_items` | variant_id, quantity 1 to 10 | FK cart_id, variant_id; unique (cart_id, variant_id) |

### State transitions

- **Product** (this slice): created as `draft` or `active`; no transitions (editing and archiving are feature 9).
- **Cart**: none → created (first add) → lines added, changed, removed (each write pushes `expires_at` to now + 30 days) → deleted by the cron once `expires_at` has passed. Feature 7 links it to a pending order.
- **Cart line flag** (computed at read time, never stored), first match wins: `unavailable` (variant archived or product not `active`) · `sold_out` (stock 0) · `insufficient(n)` (quantity above stock n, n > 0) · `ok`.

### Caching model

- `next.config.ts` sets `cacheComponents: true`.
- `getActiveProducts()` and `getProductBySlug(slug)` in `src/features/catalog/queries.ts` are `'use cache'` with `cacheLife('max')`, tagged `catalog` and `product:<slug>` respectively. The product query tags `product:<slug>` even when it finds nothing, so a cached 404 clears when that slug is created.
- The create action calls `updateTag(catalogTag)` and `updateTag(productTag(slug))` after the transaction commits. Feature 7's webhook, which changes stock, must call `revalidateTag(tag, { expire: 0 })` for `catalog` and each affected `product:<slug>` (route handlers cannot call `updateTag`).
- `/products/[slug]` exports `generateStaticParams` returning the slugs of up to 48 newest active products. Cache Components refuses an empty list, so when there are none it returns one reserved slug (`__none__`, which cannot match the slug pattern and so renders the 404). Other slugs render on first visit and are cached.
- `CartLink` in the header, the `/cart` body and the `/checkout` body read the cookie, so each sits inside its own `<Suspense>`; everything else stays in the static shell.
- Existing routes: add `export const instant = false` to every `page` and `layout` under `app/admin/` and `app/auth/`, which read the session at the top level (the `cache-components-instant-false` codemod does this; limit it to those folders). New admin pages in this slice carry it too. The footer year in `StoreShell` calls `new Date()` during render, which Cache Components rejects; move it into a small `'use cache'` component with `cacheLife('days')`. Check `src/components/ui/sidebar.tsx` (`Math.random` in the menu skeleton) builds as well.
- **Status codes under Cache Components.** Every dynamic route streams its static shell (the root layout) before the page runs, so `notFound()` and `redirect()` inside a page become a 200 with in page handling (`noindex` for a 404, a client redirect). Where the status matters, the check runs before rendering: the admin gate in the proxy (AC-19). Storefront product pages accept the soft 404 (AC-7); the proxy never runs on storefront routes. Unmatched URLs still get a real 404 (no route renders).
- **Kept pages.** Cache Components keeps recently visited routes alive in the browser (React `<Activity>`), so a client router transition away from an admin page leaves it restorable by Back. Sign out therefore leaves by a full document load (AC-20), never a router redirect.
- `next.config.ts` `images.remotePatterns` allows the host of `NEXT_PUBLIC_SUPABASE_URL` with path `/storage/v1/object/public/product-images/**`. `images.dangerouslyAllowLocalIP` is true only when that host is `127.0.0.1` or `localhost` (local and CI), never for a deployed host.

### API surface

All actions return `ActionResult` (`src/lib/result.ts`) and validate input with Zod.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| proxy (`/admin/:path*`, existing) | proxy | session cookies | refresh, redirects, and now a 404 rewrite for non admins | first gate only, never grants | real 404, real redirect to `/admin/mfa` (AC-19) |
| `/admin/sign-out` | route handler, POST | form POST, `Origin` header | 303 to `/admin/sign-in?reason=signed_out`, `no-store` | none on purpose (ends only the caller's own session, grants nothing; the one admin route without `requireAdmin()`, as the `signOut` action was) | 403 on a missing or foreign `Origin` |
| `/admin/products` | page | none | product list (AC-1) | `requireAdmin()` | 404 for non admins |
| `/admin/products/new` | page | none | create form | `requireAdmin()` | 404 for non admins |
| `createProductImageUpload` | server action | `contentType`, `size` | `{ path, token }` for `uploadToSignedUrl` | `requireAdmin()` | `unsupported_type`, `too_large` |
| `createProduct` | server action | `name`, `slug`, `description`, `status` (`draft` \| `active`), `optionTypes[] { name, values[] }`, `variants[] { values[] (value per type, by index), price (text), stock, sku }`, `image? { path, altText, width, height }` | `{ productId, slug }`, then redirect | `requireAdmin()` | `validation` (field errors), `slug_taken`, `sku_taken` (field errors, mapped from Postgres 23505), `image_missing` |
| `/` | page | none | product grid (AC-6) | public | none |
| `/products/[slug]` | page | `slug` | product page (AC-7) | public | 404 |
| `addToCart` | server action | `variantId` (uuid), `quantity` (1 to 10) | `{ lineQuantity, cartQuantity, cappedTo? }` | public (cart from cookie) | `unavailable`, `sold_out` |
| `setCartItemQuantity` | server action | `itemId` (uuid), `quantity` (1 to 10) | `{ lineQuantity, cappedTo? }` | cookie's cart only | `not_found`, `unavailable`, `sold_out` |
| `removeCartItem` | server action | `itemId` (uuid) | `{}` | cookie's cart only | `not_found` |
| `/cart` | page | cookie | cart view (AC-10, AC-11) | public | none (bad cookie = empty cart) |
| `/checkout` | page | cookie | summary (AC-13) | public | redirects to `/cart` |
| `/api/cron/expired-carts` | route handler, GET | `Authorization` header | `{ deleted }` | `Bearer ${CRON_SECRET}` | 401 |

Cart actions call `refresh()` (from `next/cache`) after a write so the header count and the cart page rerender. When the cap for a line computes to 0 (the variant sold out since it was added), `setCartItemQuantity` returns `sold_out` and writes nothing; the `cart_items` CHECK refuses a quantity of 0.

`createProduct` order: validate with Zod, then (when an image is given) check the path pattern and confirm the object exists in Storage, then run the Prisma transaction, then `updateTag`. The Storage check sits before the transaction because the two systems share no rollback.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Create product | `slug` suggestion | `slugify(name)`: Unicode NFKD, strip accents, lowercase, runs of anything other than `a-z0-9` become one `-`, trimmed, max 80; the pattern `^[a-z0-9]+(-[a-z0-9]+)*$` is enforced by Zod |
| Create product | `sku` suggestion | slug plus each value, joined with `-`, uppercased, characters outside `A-Z0-9` become `-`; any SKU is trimmed, uppercased, 1 to 64 of `A-Z0-9._-` |
| Create product | `price_cents` | `parseMoney(price text, STORE_CURRENCY)`; minimum 1 minor unit |
| Create product | `stock_quantity` | form input, integer 0 to 999999 |
| Create product | `option_key` | the variant's option value ids sorted ascending, joined with `,`; `''` for the default variant (spec 0002) |
| Create product | `position` of types, values, variants | form order, starting at 0; variants in the generated grid order |
| Create product | `status` | the button pressed: "Save as draft" → `draft`, "Publish" → `active` |
| Create product | image `storage_path` | the path returned by `createProductImageUpload`: `products/<uuid v7>.<ext>`, ext from the content type (`png`, `jpg`, `webp`, `avif`) |
| Create product | image `width`, `height` | read in the browser with `createImageBitmap` before upload; integers 1 to 10000; layout hints only |
| Create product | `adminId` in the log | `requireAdmin()` |
| Admin list | total stock, price range, variant count | aggregated from the product's non archived variants at read time |
| Admin list | created date | `products.created_at`, formatted in `STORE_TIMEZONE` and `STORE_LOCALE` |
| Home grid | card image | first `product_images` row by position, else `/placeholder.svg` |
| Home grid | price, "From" | min and max `price_cents` of non archived variants; "From" when they differ |
| Home grid, product page | "Sold out" | `availability(stock_quantity)` over non archived variants |
| Product page | availability label | `availability(stock)`: 0 → `sold_out`; 1 to 5 → `low(n)`; above 5 → `in_stock` (the count is not sent) |
| Product page | initial variant | first non archived variant by position with stock above 0, else the first by position |
| Add to cart | cart id | verified cookie; else a new `carts` row |
| Add to cart | line quantity | `min(existing + requested, lineCap(stock))`, where `lineCap(stock) = min(stock, 10)` |
| Any cart write | `carts.expires_at`, cookie Max-Age | now + 30 days (spec 0002) |
| Cart page, checkout | unit price, line total, subtotal | live `product_variants.price_cents`; line total = price × quantity; subtotal = sum |
| Every page showing money (admin list, grid, product page, cart, checkout) | formatted amount | `<Price>` with `STORE_CURRENCY` and `STORE_LOCALE` (spec 0003); no other formatter |
| Cart page | variant label | `variantLabel()` in `src/lib/variant-label.ts`; null (not shown) for a default variant |
| Cart page | line flag | `cart-lines.ts` from the variant's `archived`, the product's `status` and `stock_quantity` |
| Header | cart count | sum of `cart_items.quantity` of the cookie's cart |
| Cron | cutoff | `now()` in the database |
| Proxy admin gate | `userId`, `aal`, `amr` | `getClaims()` claims `sub`, `aal` (`aal2` or else `aal1`), `amr`; the proxy already calls it |
| Proxy admin gate | `adminRow` | `admin_users` by primary key `sub` (Prisma, `id, email, name, disabled_at`); the proxy runs on Node in Next.js 16 |
| Proxy admin gate | `allowAal1` | true only for the paths in one shared constant `aal1AdminPages` in `proxy-decision.ts` (beside `publicAdminPages`), today `['/admin/mfa']`; the pages that call `requireAdminSession({ allowAal1: true })` must match it |
| Proxy admin gate | MFA redirect target | `mfaPath(pathname + search)` from `safe-admin-path.ts`, as `requireAdmin()` does |
| Proxy admin gate | on a lookup error | fail open: continue, log `auth.proxy.lookup_failed` (warn, admin id and ip only) |
| Proxy admin gate | now | `Date.now()`, as for the existing expiry check |
| Proxy admin gate | the 404 response | `NextResponse.rewrite` to an internal path no route matches (e.g. `/admin/__denied`), so `app/not-found.tsx` renders with a real 404 status and its own title; the refreshed cookies and `no-store` are copied onto it as for the proxy's redirects |
| Sign out route | allowed origin | the request's own origin (`request.nextUrl.origin`), so previews and production both work |

### Key invariants

- Prices and stock are read from the database inside every action; no action takes a price from the client.
- A cart line quantity is always 1 to 10 (the DB CHECK guarantees above 0); the stock cap applies at write time, and the flag at read time covers stock that dropped later.
- Every product has at least one variant; a variant has exactly one value per option type; `option_key` matches `variant_option_values`. All written in the same transaction as the product.
- Cart writes lock the cart row (`SELECT ... FOR UPDATE`) inside a transaction before reading the line, so two tabs adding at once cannot exceed the cap.
- Rendering a page never writes to the database or sets a cookie; carts and cookies are created only inside `addToCart` (spec 0001).
- Storage paths are never reused or overwritten (spec 0001).
- The proxy's admin gate can only deny or redirect earlier than `requireAdmin()`, never allow what `requireAdmin()` would refuse; the pure `decideAdminAccess()` is the one rule set both call. It skips server action POSTs (the action's own `requireAdmin()` answers them, and a proxy redirect breaks an action), and skips `/admin/sign-in`, `/admin/forgot-password` and `/admin/sign-out`.
- Catalog reads that feed static pages include only `active` products and non archived variants; drafts never enter a cached storefront entry.

### Security model

- Admin: every admin page and both admin actions call `requireAdmin()` themselves; the proxy is only a first gate (spec 0004). The proxy now also denies non admins with a real 404 and logs `auth.access.denied` for them (the page's `requireAdmin()` never runs in that case, so the proxy logs it instead). It uses `getClaims()` (local token check), so a session revoked minutes ago can pass the proxy; `requireAdmin()` (`getUser()`, asks the Auth server) still refuses it, as a soft 404.
- Sign out: a POST route handler has no built in CSRF check (server actions do), so it compares `Origin` itself; a cross site page therefore cannot sign an admin out. A browser or corporate proxy that strips `Origin` gets a 403 and stays signed in; that is rare and the admin can reload, so it is accepted.
- The proxy imports the app's Prisma singleton (`src/lib/db.ts`); in Next.js 16 the proxy runs on Node in the same server process, so it shares the one client and pool. Signed upload URLs are issued only after that check, with the service role key, which never leaves the server.
- The bucket is public for reads (spec 0001); writes happen only through signed upload URLs. The bucket already limits type and size (`supabase/config.toml`); the action checks them too.
- Customers: guests are anonymous; the cart id is not secret but cannot be forged (HMAC with `timingSafeEqual`). No personal data is collected in this slice.
- The storefront pages expose only active catalog data; exact stock above 5 is withheld.
- Abuse: storefront server action POSTs get a Vercel Firewall rate limit (60 per minute per IP), applied at deploy in feature 19; the daily cron removes abandoned carts.
- Server actions keep Next.js's built in Origin check (CSRF protection); `SameSite=Lax` on the cart cookie adds to it.

### Configuration required

- `CRON_SECRET`: authenticates Vercel Cron calls to `/api/cron/*` (spec 0001). Add to `src/lib/env.ts` (at least 32 characters), `.env.example`, `tests/valid-env.ts` and the CI env block.
- `CART_COOKIE_SECRET` already exists; this slice starts using it.
- `vercel.json`: `crons: [{ path: "/api/cron/expired-carts", schedule: "0 3 * * *" }]`.
- CI: drop `storage-api` from the `supabase start -x` list so the admin image e2e test can upload.

### Critical test scenarios

- Happy path (Playwright): an admin creates a published product with Size and Color and an image; a customer opens `/`, sees it, opens it, picks a combination, adds 2, reloads `/cart` and still sees 2, changes to 3, removes another line, and reaches `/checkout` with the right subtotal, verifies **AC-2**, **AC-3**, **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-10**, **AC-13**
- Draft stays hidden: a draft product is missing from `/` and its page is 404, verifies **AC-3**, **AC-7**
- Validation (Vitest on the action and schema): duplicate slug and SKU in the DB and in the form, bad price text, too many combinations, duplicate values, missing alt text, a forged image path; nothing is written, verifies **AC-4**, **AC-5**
- Stock caps (db test): adding beyond stock or 10 sets the cap and reports it; two concurrent adds for the last units end at the cap, verifies **AC-8**
- Stale lines: set stock below a line's quantity, archive another variant, set a product to draft; the cart flags each, Checkout is disabled, `/checkout` redirects, verifies **AC-11**, **AC-13**
- Cookie (Vitest): a tampered signature, an unknown cart and an expired cart each read as no cart, and the next add issues a new cookie, verifies **AC-9**
- Cache (Playwright against the production build): the product appears right after create without a deploy; `pnpm build` on an empty migrated database succeeds, verifies **AC-3**, **AC-14**
- Auth: a signed out visitor and a non admin get 404 on `/admin/products` and `/admin/products/new`, and calling `createProduct` or `createProductImageUpload` directly returns the refusal; a line id from another cart gets `not_found`, verifies **AC-15**
- Cron (Vitest route test with the test DB): wrong or missing bearer gets 401; the right one deletes only expired carts, verifies **AC-16**
- Accessibility (Playwright + axe, desktop and phone): every page listed in AC-17, keyboard only purchase flow, verifies **AC-17**
- Admin gate (Vitest on the proxy with mocked Supabase and Prisma): no row, disabled row, `aal1` on `/admin` (redirect carries `next`) and on `/admin/mfa`, an allowed admin, a GET with the `rsc` header, a server action POST, `/admin/sign-out`, and a failing lookup (passes through and logs) each get the right outcome; the existing `denials.spec.ts` e2e checks the real 404 status and title, verifies **AC-19**
- Sign out (Vitest route test plus the existing e2e): a foreign or missing `Origin` gets 403 and keeps the session; a valid POST clears the `sb-` cookies, logs, and 303s; a GET gets 405 and keeps the session; after sign out Back shows no admin text; the MFA page button works with JavaScript disabled, verifies **AC-20**
- Logs (Vitest): each event is emitted with its fields and no cookie value or personal data, verifies **AC-18**

## Build plan

Tracer Bullet: milestone 1 threads one real product from the admin form to a cart that survives reload, through every layer (Cache Components config, Prisma, server actions, cookie, static pages, e2e in CI). Each later milestone thickens one segment. No migration is needed.

**Milestone 1: thin thread, simple product to cart**
1. [x] Turn on `cacheComponents`; add `instant = false` to the admin and auth segments; move the footer year into a cached component; replace `dynamic`/`dynamicParams` in the style guide; confirm `pnpm build` passes, satisfies **AC-14**
2. [x] Admin gate refit: the proxy reads the `admin_users` row and runs `decideAdminAccess()` (404 rewrite, real MFA redirect, `auth.access.denied` log); `app/admin/sign-out/route.ts` with the `Origin` check; the user menu item and `SignOutButton` become plain form POSTs to it; delete the `signOut` action and move its tests to the route; confirm every existing e2e test passes unchanged, satisfies **AC-14**, **AC-19**, **AC-20**
3. [x] Add `src/lib/cache-tags.ts`, `src/lib/availability.ts`, `src/lib/slug.ts`, `parseMoney` in `src/lib/money.ts`, with unit tests, satisfies **AC-4**, **AC-7**, **AC-8**
4. [x] Admin: "Products" nav entry, `/admin/products` list, `/admin/products/new` for a product with one default variant (name, slug, description, price, stock, SKU, draft or publish), `createProduct` in one transaction with `updateTag`, the `catalog.product.created` log, satisfies **AC-1**, **AC-3**, **AC-15**, **AC-18**
5. [x] Storefront: `getActiveProducts` and `getProductBySlug` as tagged `'use cache'` reads, the home grid, the product page without a picker, `generateStaticParams` with the empty catalog fallback, satisfies **AC-6**, **AC-7**, **AC-14**
6. [x] Cart: `src/lib/cart/cookie.ts` and `load-cart.ts`, `addToCart` (lazy cart plus cookie, row lock, caps), a read only `/cart`; e2e: admin creates and publishes, customer adds, reloads the cart, satisfies **AC-8**, **AC-9**, **AC-10**, **AC-15**

**Milestone 2: options and variants**
7. [x] `variant-grid.ts` (combinations, `option_key`, SKU suggestion, 100 limit) with unit tests; the option types editor and the generated grid in the create form; `createProduct` writes types, values, variants and links; field errors for every AC-4 case including mapped 23505s, satisfies **AC-2**, **AC-3**, **AC-4**
8. [x] Product page picker: radio groups, disabled sold out values, initial selection, price and availability updates, `variant-label.ts`, satisfies **AC-7**

**Milestone 3: product image**
9. [x] `src/lib/supabase/admin.ts`, `createProductImageUpload`, browser upload with `uploadToSignedUrl`, dimension read, alt text, the path and existence check in `createProduct`; `next.config.ts` image settings; enable `storage-api` in CI; e2e with a fixture image, satisfies **AC-5**, **AC-6**

**Milestone 4: full cart and checkout stub**
10. [ ] `setCartItemQuantity`, `removeCartItem`, `cart-lines.ts` flags and fixes, disabled Checkout with its reason, `CartLink` in the header behind Suspense, toasts and a live region, `/checkout` summary with its redirects, `noindex` on both pages, satisfies **AC-10**, **AC-11**, **AC-12**, **AC-13**

**Milestone 5: cleanup, logs and accessibility**
11. [ ] `CRON_SECRET` in env, `/api/cron/expired-carts`, `vercel.json`, the `cart.cookie.invalid` and `cron.expired_carts` logs, satisfies **AC-16**, **AC-18**
12. [ ] axe and keyboard e2e for every page in AC-17 on desktop and phone, satisfies **AC-17**

## Consequences

**Positive**:
- The whole path a real sale needs exists and is tested; feature 7 only adds the email form, the pending order, Stripe and the webhook.
- Catalog pages are static and still update the moment an admin saves; the cart count does not force them to render per request.
- Price and stock are always checked on the server, so a tampered request cannot buy cheaper or beyond stock.
- The shared `src/lib/cart/`, `availability`, `variant-label` and cache tag modules give features 7, 9 and 12 one rule each to reuse.

**Negative / tradeoffs**:
- The proxy now reads the database on every admin page request (one primary key lookup) and imports Prisma, so it is no longer a pure session refresher. Admin traffic is tiny, and storefront routes never run the proxy.
- Unknown, draft and archived product slugs answer 200 with `noindex`, not 404. Search engines drop them, but uptime or analytics tools that count 404s will not see them.
- Turning on Cache Components changes the rules for every route: new pages must keep request data behind Suspense, `new Date()` cannot run in the static shell, and admin and auth segments carry `instant = false` until someone converts them.
- The product page can show stale stock until a tag expires; a customer may see "In stock" and then get "Sold out" on add. Feature 7 must remember to expire the tags when stock changes.
- The home grid stops at 48 products and the admin list at 200 until features 13 and 9 add paging.
- Without edit, an admin mistake is fixed only by feature 9 or by hand in the database.
- Images uploaded for a product that is never saved stay in the bucket until feature 9 sweeps them.
- Cart spam is limited only at deploy (feature 19); before that a script can create cart rows, cleaned daily by the cron.

**Neutral**:
- Two first adds at the same instant from a cookieless browser create two carts; the later cookie wins and the other cart expires.
- `products.position` stays 0 for now, so newest first decides the order until feature 9 adds reordering.
- The description is plain text; Markdown rendering can come with feature 9.

## Follow-up

- [ ] Feature 7: expire `catalog` and each affected `product:<slug>` with `revalidateTag(tag, { expire: 0 })` in the webhook whenever stock changes; reuse `src/lib/cart/` and `variant-label.ts` for the order snapshot; replace the checkout notice with the email form and Pay.
- [ ] Feature 9: editing, archiving, reordering, several images, Markdown description, admin list paging, and a sweep of unreferenced files in `product-images`; expire the old and new `product:<slug>` tags when a slug changes.
- [ ] Feature 13: paging and sorting for the product list (replaces the cap of 48). Sorting by `created_at` has no index today (fine at 48 and 200 rows); add one on `(status, created_at)` with paging if query plans call for it.
- [ ] Feature 19: add the Vercel Firewall rate limit on storefront server action POSTs (60 per minute per IP) to its production checklist, and confirm the cron runs on the production project.
- [ ] Feature 12: widening the proxy matcher to account routes must keep the admin gate on `/admin` only; a customer session must hit the proxy's 404 on `/admin`, never a customer page.
- [ ] Any future admin page that allows `aal1` (calls `requireAdminSession({ allowAal1: true })`) must be added to `aal1AdminPages` too, or the proxy will bounce it to the MFA step.
- [ ] Feature 12: merge a guest cart into the customer's cart at sign in (the cookie cart has `customer_id` null).
- [ ] Convert the admin and auth segments off `instant = false` when convenient, using the Cache Components migration guide.
- [ ] `/sync` records the Cache Components rules (Suspense around request data, tags in `src/lib/cache-tags.ts`, no `new Date()` in the shell) in root `AGENTS.md`.
- [ ] `accessibility`, `playwright-best-practices`, `next-dev-loop`, `react-email`, `resend`, `tailwind-4-docs` and others are installed but missing from the `## Agent skills` list in root `AGENTS.md`; `/sync` or `/audit` should add them.
