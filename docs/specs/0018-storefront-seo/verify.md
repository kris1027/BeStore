# Verify: SEO for storefront pages · spec 0018 · updated 2026-10-23
_Steps derived from spec 0018 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Read every page with a Googlebot user agent (or wait for the streamed tags), since Next only blocks on metadata for known bots.

## UI / manual
- [x] Any storefront page → every `og:url`, canonical and `og:image` is absolute on `NEXT_PUBLIC_SITE_URL`, never `localhost` in a deployed build → AC-1
- [x] Home, a category, a product, `/terms` and `/search` → `og:type` website, `og:site_name` the brand, `og:image` with width, height and alt, `twitter:card` summary_large_image with the same image; set `STORE_LOCALE=pl-PL` → `og:locale` is `pl_PL`, with `en` there is none → AC-2
- [x] Open `/brand-card.png` → a 1200x630 PNG with the brand name in the foreground colour on the background colour; it is the `og:image` of home, categories, legal pages, `/search` and a product with no photo → AC-3
- [x] Open `/logo.png` → a 512x512 PNG with the uppercased first letter of the brand; the tab icon shows the same → AC-4
- [x] A product with `meta_title` and `meta_description` set in the database → those are its title and description; clear them → the name and the description's plain text; its `og:image` is the first gallery photo with its alt (or the name) → AC-5
- [x] A product whose Markdown description is longer than 160 characters → the meta description has no Markdown syntax, ends at a word with `…`, and is at most 160 characters → AC-6
- [x] A product with two variants (one with a "Was" price, one sold out) → one `Product` script with `image` in gallery order, `brand`, and two Offers in variant order with SKU, `"129.00"` style prices, InStock / OutOfStock, NewCondition, no stock count → AC-7, AC-8
- [x] The variant with a compare at price above its price → `priceSpecification` StrikethroughPrice with the "Was" price; set compare at equal to the price → no strikethrough → AC-9
- [x] In `/admin/settings` set the flat fee 9.99 and the free threshold 100 → a 50.00 variant shows `shippingRate` 9.99, a 129.00 variant shows 0; remove the threshold → both 9.99, on the next request → AC-10
- [x] Rename a product to `</script><script>alert(1)</script>` → no alert, the JSON-LD parses and holds the name → AC-11
- [x] On a category with more than 24 products: `?page=2` → canonical `?page=2` and title `<name>, page 2 · BeStore`; `?page=99` → the last page; `?page=0`, `?page=abc`, `?page=1`, `?sort=featured`, `?stock=0`, `?utm_source=x`, `?color=red&page=2`, `?sort=price-asc` → the plain path and the plain title → AC-12, AC-13
- [x] A category with `meta_title` / `meta_description` → those win; without → the name and the description cut to 160 characters, kept as plain text (`**cool**` stays as typed) → AC-14
- [x] Home → JSON-LD Organization (name, url, logo `/logo.png`) and WebSite, no SearchAction → AC-15
- [x] A category → BreadcrumbList of the brand then the category → AC-16
- [x] `/search?q=scarf` → `noindex, follow`, no canonical, no JSON-LD, the brand card, and "scarf" nowhere in the head → AC-17
- [x] A draft product, an archived one, a product hidden after it was visited, and a hidden category → the not found page with `noindex`, no JSON-LD, no canonical → AC-21
- [x] `/cart`, `/checkout`, `/checkout/complete`, the account pages (signed out and signed in), the admin auth pages and every admin panel page → still `noindex`, no canonical, no JSON-LD → AC-22
- [ ] On a preview build, run one product page through Google's Rich Results Test → Product with Offers detected, only the expected return policy and delivery time warnings → AC-7 to AC-10 _(open: no preview deploy exists yet; a spec 0018 follow-up)_

## Commands
- [x] `curl -s localhost:3000/sitemap.xml` → home, the five legal pages with their `updated` dates, every visible category, every active product with a live variant and its image URLs; no draft, archived, variant less product, hidden category, query URL, account, cart, checkout, search, admin or auth path → AC-18
- [x] Publish a draft product in the admin, then fetch `/sitemap.xml` again → it is listed; hide it → it is gone, with no deploy (also on `pnpm build && pnpm start`); the same for a category shown and hidden → AC-19 _(dev server locally; the production build through the CI e2e job, which runs `tests/e2e/seo` on `pnpm build && pnpm start`)_
- [x] `curl -s localhost:3000/robots.txt` → `User-Agent: *` / `Disallow: /`, no sitemap line → AC-20
- [x] `pnpm test -- src/lib/seo/robots.test.ts` → the production branch allows `/`, disallows `/admin`, `/api`, `/auth`, names the sitemap → AC-20
- [x] `pnpm test:db -- tests/db/sitemap.db.test.ts` → passes → AC-18, AC-19
- [x] `pnpm test:e2e tests/e2e/seo` → passes → AC-5 to AC-9, AC-11, AC-12, AC-15 to AC-22

## Acceptance-criteria coverage
- AC-1 … UI 1 · AC-2 … UI 2 · AC-3 … UI 3 · AC-4 … UI 4 · AC-5 … UI 5 · AC-6 … UI 6 · AC-7, AC-8 … UI 7 · AC-9 … UI 8 · AC-10 … UI 9 · AC-11 … UI 10 · AC-12, AC-13 … UI 11 · AC-14 … UI 12 · AC-15 … UI 13 · AC-16 … UI 14 · AC-17 … UI 15 · AC-18 … Commands 1, 5 · AC-19 … Commands 2 · AC-20 … Commands 3, 4 · AC-21 … UI 16 · AC-22 … UI 17
