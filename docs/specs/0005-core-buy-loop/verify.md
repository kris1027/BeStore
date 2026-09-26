# Verify: core buy loop · spec 0005 · updated 2026-09-26
_Steps derived from spec 0005 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Sign in as an admin, open the sidebar → a "Products" entry leads to `/admin/products` → AC-1
- [ ] `/admin/products` on an empty catalog → Empty state with "New product"; with products → newest first, name, status, variant count, total stock, price (a range when prices differ), created date → AC-1
- [ ] Create a product at 23:30 UTC with `STORE_TIMEZONE=Europe/Warsaw` → the list shows the Warsaw date, not the UTC one → AC-1 (value: created date)
- [ ] `/admin/products/new`: type a name → URL name follows it until you edit it; add Size (S, M) and Color (Navy) → two rows in option order; add Color "Oat" → two new rows, typed prices kept; SKUs read `<SLUG>-<VALUES>` uppercased → AC-2 (values: slug, SKU suggestions, option_key, positions)
- [ ] Options making more than 100 combinations → message, no rows → AC-2
- [ ] Publish → toast, back on the list; the product shows on `/` and at `/products/<slug>` straight away (production build) → AC-3
- [ ] Save as draft → missing from `/`; its product page shows the 404 page with `noindex` → AC-3, AC-7
- [ ] Each refusal shows on its field and nothing is saved: malformed slug, `19.999` in EUR, `0`, stock `-1` and `1000000`, duplicate SKU in the form, duplicate value `S`/`s`, slug or SKU already used by another product → AC-4
- [ ] Price `19.99` with `STORE_CURRENCY=JPY` → refused for decimals; `1999` → saved as 1999 → AC-4 (value: price_cents)
- [ ] Attach a PNG → preview and a required alt text; publish without alt text → error on Alt text; with it → `/` and the product page show the image with that alt → AC-5, AC-6
- [ ] Pick a `.txt` or a file over 10 MB → refused before any upload → AC-5
- [ ] `/` lists up to 48 active products, image or placeholder in the 4:5 box, "From €X" when prices differ, "Sold out" when every variant has 0 stock; empty catalog → Empty state → AC-6 (values: card image, price, "From", "Sold out")
- [ ] Product page: name as `h1`, price, "In stock" / "Only N left" (at 5 or fewer) / "Sold out"; a value with only sold out or missing combinations is disabled and says "(sold out)"; the first in stock variant is selected at load; changing the selection updates price and availability → AC-7 (values: availability label, initial variant)
- [ ] View source of a product page with a variant at stock 12 → the number 12 appears nowhere → AC-7
- [ ] Add to cart → toast with "View cart", header shows "Cart, N items"; add more than stock → "Only N available" and the line holds N; a line never exceeds 10 → AC-8, AC-12 (value: line quantity)
- [ ] After the first add, the `bestore_cart` cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, about 30 days → AC-9 (value: expires_at, cookie Max-Age)
- [ ] Edit the cookie's signature by hand, reload `/cart` → empty cart, no error page; add again → a new cart and cookie → AC-9
- [ ] `/cart`: change quantity, remove a line, reload → changes kept; subtotal = sum of live price × quantity → AC-10 (values: unit price, line total, subtotal)
- [ ] In the database set one line's stock below its quantity, another's to 0, and a product to draft → "Only N left" with "Set to N", "Sold out" and "No longer available" with Remove; Checkout disabled with its reason; `/checkout` sends you back to `/cart` → AC-11, AC-13 (value: line flag)
- [ ] `/checkout` with a clean cart → lines and subtotal from current prices, plus the "Payment comes next" notice; `/cart` and `/checkout` carry `robots: noindex` → AC-13
- [ ] Sign in as a user with no `admin_users` row, open `/admin` → status 404, title "Page not found · BeStore"; at `aal1`, open `/admin/products?x=1` → real redirect to `/admin/mfa?next=%2Fadmin%2Fproducts%3Fx%3D1` → AC-19 (values: adminRow, allowAal1, MFA redirect target)
- [ ] Sign out from the user menu → sign in page with "signed out"; press Back → no admin content → AC-20
- [ ] Every page in AC-17 on desktop and phone: keyboard only picker, quantity, cart controls and the create form; screen reader hears quantity changes and toasts → AC-17

## Commands
- [ ] `pnpm build` against an empty, migrated database → succeeds (product params fall back to `__none__`) → AC-14
- [ ] `pnpm test` → schema, picker, variant grid, availability, cart lines, cookie signature, proxy gate and sign out route suites pass → AC-2, AC-4, AC-7, AC-9, AC-11, AC-19, AC-20
- [ ] `pnpm test:db` → create product, cart actions (caps, concurrent adds, other cart's lines), expired carts suites pass → AC-3, AC-4, AC-5, AC-8, AC-9, AC-10, AC-15, AC-16, AC-18
- [ ] `pnpm test:e2e` (production build on port 3000) → catalog, cart, image, a11y and every existing admin suite pass → AC-3, AC-5, AC-6, AC-7, AC-10 to AC-14, AC-17, AC-19, AC-20
- [ ] `curl -i localhost:3000/api/cron/expired-carts` → 401; with `-H "Authorization: Bearer $CRON_SECRET"` → `{"deleted":N}`, only carts past `expires_at` gone, log line `cron.expired_carts` → AC-16, AC-18
- [ ] `curl -i -X POST localhost:3000/admin/sign-out -H "Origin: https://evil.example"` → 403; `curl -i localhost:3000/admin/sign-out` → 405 → AC-20
- [ ] Call `createProduct` or `createProductImageUpload` as a non admin → refused; call `setCartItemQuantity` with another cart's line id → `not_found` → AC-15
- [ ] Logs from a create, a forged cart cookie and the cron show `catalog.product.created` (admin id, product id, status), `cart.cookie.invalid` (no value), `cron.expired_carts` (count), and no customer data → AC-18

## Acceptance-criteria coverage
- AC-1 list and nav · AC-2 grid and suggestions · AC-3 publish and draft · AC-4 field refusals · AC-5 image upload · AC-6 home grid · AC-7 product page and picker · AC-8 add and caps · AC-9 cookie · AC-10 cart edits · AC-11 flags · AC-12 header count · AC-13 checkout · AC-14 empty build and cache · AC-15 authorization · AC-16 cron · AC-17 accessibility · AC-18 logs · AC-19 proxy gate · AC-20 sign out
