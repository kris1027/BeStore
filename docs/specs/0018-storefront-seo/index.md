# 0018. Storefront SEO

**Date**: 2026-10-23
**Status**: Accepted

## Summary

Every public storefront page gets complete search and share metadata: a unique title and description, an absolute canonical link, and an Open Graph share card (the preview a link shows in chats and social apps). Product pages also get Product structured data (JSON-LD, a machine readable block search engines read), with one Offer per variant, the "Was" price as a strikethrough price, and the delivery fee. The store also gets a `robots.txt` that blocks all crawling outside production, a sitemap of every public page, a generated brand share card and logo, and a canonical rule for paged and filtered listings. Nothing in the database changes.

## Requirements

**User stories**:
- As a shopper searching the web, I want a product's result to show its real price, availability and sale, so I click through to something I can buy.
- As a shopper sharing a link, I want it to show the product photo (or the store card) and a clear title, so the person I send it to knows what it is.
- As the store owner, I want every public product and category found and nothing private or hidden indexed, so search traffic lands on pages that sell.
- As the developer, I want preview deploys kept out of search engines without remembering to do anything, so a test catalog never competes with the real store.

**Acceptance criteria** (the contract, each independently checkable):

*Site wide*
- **AC-1**: The root layout sets `metadataBase` to `NEXT_PUBLIC_SITE_URL`, so every canonical, Open Graph and sitemap URL is absolute on the site's own origin (never `localhost` in a deployed build).
- **AC-2**: Every indexable storefront page (home, category, product, the five legal pages) and `/search` declares its metadata through one shared helper, `pageMetadata` (it replaces `legalMetadata` and the category page's hand written metadata, no duplicates): `title`, `description` (when there is one), `alternates.canonical` (absolute; not on `/search`), and `openGraph` with `type: "website"`, `siteName` (brand name), `url` (equal to the canonical), `title`, `description`, and `images` always set explicitly (url, width, height, alt), plus `twitter.card: "summary_large_image"` and `twitter.images` set to the same image. `og:locale` is `STORE_LOCALE` written with an underscore (`pl_PL`) when the tag has a region, and omitted when it is a bare language (`en`).
- **AC-3**: A generated brand share card is served at the fixed path `/brand-card.png` (a route handler returning next/og `ImageResponse`, 1200x630 PNG, prerendered and cached since it reads no request data): the brand name in next/og's default font, on `brand.colors.background` in `brand.colors.foreground`. It is the image of the home page, every category page, every legal page, `/search` and any product with no photo, with alt text the brand name. `brand.colors` is a new field in `src/lib/brand/brand.ts` holding sRGB hex values, because next/og cannot read the `oklch` CSS tokens; a comment there says a rebrand updates them with the tokens, and a unit test fails when they drift from the `globals.css` tokens.
- **AC-4**: A generated logo is served at the fixed path `/logo.png` (route handler, next/og, 512x512 PNG: the first letter of `brand.name`, uppercased, in `brand.colors.foreground` on `brand.colors.background`). `app/icon.tsx` renders the same image as the site's tab icon. `favicon.ico` stays.

*Product pages*
- **AC-5**: A product page's title is `meta_title`, else the product name (here and in AC-14, a blank or whitespace only meta field counts as unset, since the admin form can save one). Its description is `meta_description`, else the plain text of the Markdown description (AC-6), else none (the site default shows). Its canonical is `NEXT_PUBLIC_SITE_URL` plus `/products/<slug>`. Its `og:image` is the first gallery image by position (absolute Supabase public URL) with that image's alt text (the product name when the alt is empty) and its width and height when known; no image → the brand card (AC-3).
- **AC-6**: The description fallback is the Markdown rendered to plain text (no syntax, no HTML), whitespace collapsed to single spaces, cut at the last word boundary so the result, its `…` included, is at most 160 characters (`…` only when cut). An empty result means no description.
- **AC-7**: A product page renders one `<script type="application/ld+json">` holding a schema.org `Product`: `name`, `description` (the AC-6 plain text, untruncated up to 5000 characters), `url` (the canonical), `image` (every gallery image URL, in gallery order; omitted with no photo), `brand` (`Brand` named `brand.name`), and `offers`: one `Offer` per live (non archived) variant, in variant order. `image` holds every gallery image, those tied to an option value included. The script mounts inside `ProductDetails` after its not found check, so a hidden product renders none.
- **AC-8**: Each `Offer` has `sku` (the variant SKU), `price` (the variant price in major units as a decimal string with the currency's fraction digits, e.g. `"129.00"`), `priceCurrency` (`STORE_CURRENCY`), `availability` (`https://schema.org/InStock` for in stock and low stock, `https://schema.org/OutOfStock` for sold out), `itemCondition` (`https://schema.org/NewCondition`), `url` (the product canonical), and `shippingDetails` (AC-10). It never carries a stock count.
- **AC-9**: When a variant has a compare at price above its price, its `Offer` also carries `priceSpecification`: a `UnitPriceSpecification` with `priceType: "https://schema.org/StrikethroughPrice"`, `price` (the compare at price, formatted as in AC-8) and `priceCurrency`. A compare at price at or below the price adds nothing (the page shows no "Was" either).
- **AC-10**: `shippingDetails` is one `OfferShippingDetails` with `shippingDestination` (`DefinedRegion`, `addressCountry: STORE_COUNTRY`) and `shippingRate` (`MonetaryAmount` in `STORE_CURRENCY`): the value of `shippingCents` (`src/lib/shipping/rule.ts`, the same rule the cart uses) for a one item order whose subtotal is the variant price, so `0` at or above a free delivery threshold and the flat fee otherwise. The settings come from `getShippingSettings()`, so saving `/admin/settings` changes the data on the next request.
- **AC-11**: The JSON-LD is serialized with every `<` written as `<`, so a product name or description holding `</script>` can never close the tag.

*Listings*
- **AC-12**: Home and category pages declare their canonical by one pure rule on the parsed `ListingState` (from `parseListingParams`), never on raw params. When the state differs from the default state in anything but `page` (any price bound, `inStock`, `onSale`, any option filter, or a sort other than `defaultSort(kind)`), the canonical is the plain path. Otherwise it is the plain path for page 1 and `<path>?page=N` for page N, where N is the page actually shown: the parsed page clamped to the page count, computed by one function exported from `listing.ts` that `buildListing` also uses, so the two cannot drift. So `?page=0`, `?page=abc`, `?page=1`, `?sort=featured`, `?stock=0` and unknown params (`?utm_source=x`) all give the plain path.
- **AC-13**: For page N above 1 (the unfiltered case of AC-12), the title gains `, page N` (e.g. `Shoes, page 2 · BeStore`); filtered views keep the plain title. No search query or filter text ever appears in a title or any metadata (spec 0013 AC-24 still holds).
- **AC-14**: A category's title is `meta_title`, else its name (unchanged). Its description is `meta_description`, else its description cut by the AC-6 rule. The category description is plain text (the header shows it as is), so it is never parsed as Markdown: `*`, `#` or `[x](y)` stay in the meta description as on the page.
- **AC-15**: The home page renders JSON-LD, in its static shell, for an `Organization` (`name`, `url` the site URL, `logo` the absolute `/logo.png` URL) and a `WebSite` (`name`, `url`), with no `SearchAction`.
- **AC-16**: Each category page renders JSON-LD for a `BreadcrumbList` with two items: the brand name linking the site URL, then the category name (from `getCategoryBySlug`) linking the category canonical (plain path). The script mounts inside `CategoryHeader` after its not found check, so a hidden or unknown category renders none.
- **AC-17**: `/search` stays `noindex, follow` with no canonical, no JSON-LD and the brand card as its share image.

*Sitemap and robots*
- **AC-18**: `/sitemap.xml` lists, with absolute URLs: the home page (no `lastModified`); the five legal pages from `legalDocuments` (`lastModified` each document's `updated`, passed as its `YYYY-MM-DD` string); every visible category (`lastModified` its `updated_at`); every `active` product with at least one live variant (`lastModified` its `updated_at`, plus `images` holding its gallery image URLs). It lists nothing else: no draft, archived or variant less product, no hidden category, no paged or filtered URL, no account, cart, checkout, search, admin or auth path.
- **AC-19**: The sitemap reads through `'use cache'` functions (one in `src/features/catalog/`, one in `src/features/categories/`, composed by `app/sitemap.ts`) tagged `catalog` and `categories` and returning dates as ISO strings, so a product or category write that already expires those tags (spec 0009, spec 0013 AC-22) shows in the sitemap on the next request, with no deploy.
- **AC-20**: When `VERCEL_ENV` is `production`, `/robots.txt` allows `/`, disallows `/admin`, `/api` and `/auth`, and names `<NEXT_PUBLIC_SITE_URL>/sitemap.xml`. In every other environment (preview, development, local, CI) it is `User-agent: *` / `Disallow: /` with no sitemap line. The rule is a pure `robotsRules(vercelEnv, siteUrl)` with unit tests for both branches (e2e only ever sees the blocking branch, since CI has no `VERCEL_ENV`). `robots.ts` prerenders at build, which is right because Vercel builds each production deployment with `VERCEL_ENV=production`.

*Hidden and private pages*
- **AC-21**: A draft, archived or variant less product URL, and a hidden or unknown category URL, render the not found page with `<meta name="robots" content="noindex">` in the HTML (even though Cache Components answers 200), and emit no product or breadcrumb JSON-LD and no product metadata. This holds both for a slug that was missing at build (the prerendered `__none__` style miss) and one that disappears later (a product unpublished after build, a request time miss).
- **AC-22**: The cart, checkout, checkout complete, every account page and every admin and auth page keep `noindex` (they all do today); this feature adds no canonical, JSON-LD or sitemap entry to any of them.

## Decision

**Chosen option**: Option 1: Next.js metadata files plus one shared metadata helper and pure JSON-LD builders

Use Next's built in metadata conventions (`generateMetadata`, `sitemap.ts`, `robots.ts`, `icon.tsx`) plus two fixed path image routes, driven by one helper in `src/lib/seo/` and pure functions that build each JSON-LD object from the existing cached reads, with no new service and no schema change.

**Implementation skills**: `vercel:next-cache-components` (Vercel plugin) · `vercel:nextjs` (Vercel plugin) · `playwright-best-practices` (`.agents/skills/playwright-best-practices/`)

**Calls made in this spec** (pick, why, runner up):
- **One Product with one Offer per variant, not ProductGroup.** Eligible for merchant listings with per variant price and availability, and needs no per variant URL (the product page has no `?variant=` param, and adding one would make the page read search params). Runner up: ProductGroup with `hasVariant`.
- **Low stock counts as `InStock`.** schema.org `LimitedAvailability` means "limited run", not "few left"; and the AC-8 rule keeps counts off the page (spec 0005 AC-7). Runner up: `LimitedAvailability` for the low state.
- **Shipping rate per offer from the variant price against the threshold.** Exact for a one item order, the case a search result describes, with no new data. Runner up: always the flat fee (wrong for items above the threshold).
- **No `deliveryTime` and no return policy in the Offer.** Neither has a source in the data today (the 14 day window lives only in the legal Markdown); inventing either in code risks contradicting the legal text. Runner up: hardcode 14 days.
- **Markdown to plain text with `mdast-util-from-markdown` plus `mdast-util-to-string`, added as direct dependencies.** Both already ship inside `react-markdown`'s tree, so nothing new runs; a regex strip breaks on links, emphasis and code. Runner up: regex.
- **JSON-LD typed with `schema-dts` (dev dependency, types only).** Catches a misspelled property at compile time with zero runtime cost. Runner up: hand written readonly types.
- **Canonical uses the clamped page.** `?page=99` on a 3 page listing shows page 3, so it says page 3; anything else declares a canonical for content it doesn't show. The clamp needs the in scope product count, from the same cached `getListingIndex()` read the page already makes. Runner up: the raw page param.
- **`, page N` in the title for N above 1.** Self canonical pages need distinct titles, or the "unique metadata" bar fails on paged listings. Runner up: identical titles.
- **robots disallows only `/admin`, `/api`, `/auth`.** Cart, checkout, account and search must stay crawlable so bots can read their `noindex`; a disallowed URL can still be indexed from links, without its noindex ever being seen.
- **Brand card and logo generated, not static files.** No asset exists; generating from `brand.ts` means a rebrand updates them. Runner up: a supplied PNG.
- **Fixed path route handlers, not the `opengraph-image` file convention.** The file convention gives a hashed URL that pages and the Organization logo can't name, and a child page's own `openGraph` can drop the inherited image (Next merges metadata objects shallowly). A fixed URL set explicitly on every page is deterministic and testable. Runner up: the file convention plus an e2e guard.
- **next/og's default font.** The `next/font` fonts in `fonts.ts` can't be loaded as raw font data by next/og without bundling the files a second time. Runner up: ship the font files for next/og.

## Feature design

**Data model sketch**: no change. Reads only existing columns: `products` (`name`, `slug`, `description`, `status`, `meta_title`, `meta_description`, `updated_at`), `product_variants` (`sku`, `price_cents`, `compare_at_price_cents`, `stock_quantity` turned into availability, `archived`, `position`), `product_images` (`storage_path`, `alt_text`, `width`, `height`, `position`), `categories` (`name`, `slug`, `description`, `visible`, `meta_title`, `meta_description`, `updated_at`), `store_settings` (`flat_shipping_cents`, `free_shipping_threshold_cents`), and the legal documents' front matter.

**State transitions**: none.

**API surface** (all public, all GET, no auth):
| Endpoint / function | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/sitemap.xml` (`app/sitemap.ts`) | metadata route | none | XML urlset (AC-18) | public | a DB failure fails the render (no stale partial list) |
| `/robots.txt` (`app/robots.ts`) | metadata route | `VERCEL_ENV` | robots rules (AC-20) | public | none |
| `/brand-card.png` (`app/brand-card.png/route.tsx`) | GET route handler, `ImageResponse` | `brand.name`, `brand.colors` | 1200x630 PNG | public | none (prerendered) |
| `/logo.png` (`app/logo.png/route.tsx`) | GET route handler, `ImageResponse` | `brand.name`, `brand.colors` | 512x512 PNG | public | none (prerendered) |
| `app/icon.tsx` | metadata image | the same renderer as `/logo.png` | tab icon | public | none |
| `pageMetadata({ title, description, path, image? })` in `src/lib/seo/metadata.ts` | pure helper (routes call it as `storePageMetadata(page)` from `src/lib/seo/site.ts`, which passes the env bound site facts) | page values | `Metadata` (AC-2) | n/a | none |
| `productJsonLd(view, settings, facts)` in `src/features/catalog/seo.ts` | pure | `ProductView`, `ShippingSettings`, currency, country, site URL | `WithContext<Product>` | n/a | none |
| `listingCanonical(path, state, kind, pageCount)` in `src/features/catalog/listing/` | pure | parsed `ListingState`, page count | absolute URL + page number for the title | n/a | none |
| `plainExcerpt(markdown, max)` / `textExcerpt(text, max)` in `src/lib/seo/text.ts` | pure | Markdown or plain text, limit | string or null | n/a | none |
| `jsonLdScript(data)` component in `src/lib/seo/` | server component | object | escaped `<script>` (AC-11) | n/a | none |
| `getSitemapEntries()` in `src/features/catalog/` and `src/features/categories/` (one each) | `'use cache'` reads | none | slugs, `updated_at`, image paths | server only | none |

`getProductBySlug` (and `ProductView`) gains `metaTitle`, `metaDescription` and each variant's `sku`. The SKU is not sensitive (it already shows to admins and on order lines).

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| all pages | site origin | `NEXT_PUBLIC_SITE_URL` (env) |
| all pages | site name, Brand name | `brand.name` (`src/lib/brand/brand.ts`) |
| all pages | `og:locale` | `STORE_LOCALE`, region part only (AC-2) |
| product metadata | title / description | `products.meta_title` / `meta_description`, else `name` / `plainExcerpt(description)` |
| product metadata | `og:image` | first `product_images` row by `position, id` through `productImageUrl`, else the brand card |
| product JSON-LD | `sku`, `price`, strikethrough | `product_variants.sku`, `price_cents`, `compare_at_price_cents`, formatted with `fractionDigits(STORE_CURRENCY)` from `src/lib/money.ts` |
| product JSON-LD | `availability` | `availability(stock_quantity).kind` (`src/lib/availability.ts`), mapped by AC-8 |
| product JSON-LD | `priceCurrency` | `STORE_CURRENCY` |
| product JSON-LD | `shippingRate` | `getShippingSettings()` (`flatShippingCents`, `freeShippingThresholdCents`) against the variant price |
| product JSON-LD | `shippingDestination` | `STORE_COUNTRY` |
| product JSON-LD | `itemCondition` | constant `NewCondition` (the engineer confirmed the store sells only new items) |
| listing canonical | page shown | `parseListingParams` page clamped by `ceil(inScopeCount / PAGE_SIZE)`, the count from `getListingIndex()` scoped like `buildListing` |
| listing canonical | "filtered or sorted" | `ListingState` fields vs `defaultSort(kind)` (`params.ts`) |
| category metadata | title / description | `categories.meta_title` / `meta_description`, else `name` / `textExcerpt(description)` (plain text, no Markdown parse) |
| Organization | `logo` | `NEXT_PUBLIC_SITE_URL` plus `/logo.png` |
| brand card, logo | colours | `brand.colors` (new, sRGB hex, in `brand.ts`) |
| logo | letter | first character of `brand.name`, uppercased |
| product shipping | rate | `shippingCents({ subtotalCents: price, discountCents: 0 }, settings)` from `src/lib/shipping/rule.ts` |
| sitemap | legal `lastModified` | `legalDocuments[slug].updated` |
| sitemap | product / category `lastModified` | `products.updated_at` / `categories.updated_at` |
| robots | environment | `VERCEL_ENV` (already in `env.ts`; unset locally means "not production") |

**Key invariants**:
- Structured data only ever describes what the page shows: the same live variants, prices and "Was" prices, never a stock count, never a hidden product.
- Every URL written into metadata, JSON-LD or the sitemap is absolute on `NEXT_PUBLIC_SITE_URL` (images on the Supabase public bucket).
- Only production allows crawling; the default (any unknown or missing `VERCEL_ENV`) is to block.
- No metadata, title or JSON-LD ever contains search or filter text from the URL.
- Every JSON-LD script goes through `jsonLdScript`, the one place that escapes `<`.
- Rendering stays as today: product and category shells static, listing results behind Suspense. The listing pages' `generateMetadata` now reads `searchParams`, which is allowed because those pages already defer their results to request time.

**Security model**: everything here is public and read only. The risks are leaking what should stay hidden (draft products, stock counts, preview catalogs), closed by AC-8, AC-18, AC-20 and AC-21, and script injection through admin entered text, closed by AC-11. No PII is read. No new compliance scope, but see the Omnibus note in `rationale.md` on repeating the "Was" price.

**Configuration required**: none new. Uses `NEXT_PUBLIC_SITE_URL`, `VERCEL_ENV`, `STORE_CURRENCY`, `STORE_COUNTRY`, `STORE_LOCALE`.

**Critical test scenarios**:
- Happy path: a product with two variants (one on sale, one sold out) renders a Product with two Offers, the right prices, one StrikethroughPrice, InStock and OutOfStock, and the free or flat shipping rate; the page's `og:image` is its first photo, verifies **AC-5**, **AC-7** to **AC-10**
- Failure case: a product named `</script><script>alert(1)</script>` renders valid, inert JSON-LD, verifies **AC-11**
- Failure case: `?page=99` on a 3 page category canonicalizes to `?page=3`; `?color=red&page=2` and `?sort=price-asc` canonicalize to the plain path; `?utm_source=x` is ignored, verifies **AC-12**, **AC-13**
- Hidden: a draft product URL shows the not found page with `noindex` and no JSON-LD, and is absent from the sitemap, verifies **AC-18**, **AC-21**
- Environment: `robotsRules` with `VERCEL_ENV` unset or `preview` is `Disallow: /`; with `production` it lists the sitemap and the three disallows (unit test); the e2e build serves the blocking branch, verifies **AC-20**
- Test note: e2e checks of the head on home and category pages send a Googlebot user agent (Next then blocks on metadata and puts it in the first chunk), or wait for the streamed tags, so they never flake on streaming

## Build plan

Tracer Bullet: the first task proves one product all the way from the database to the HTML a crawler reads, the sitemap and robots; the rest thicken it.

1. Thin thread: `metadataBase` in the root layout; `src/lib/seo/` with `pageMetadata`, `plainExcerpt` and `jsonLdScript`; extend `getProductBySlug` with `metaTitle`, `metaDescription` and `sku`; the product page's full metadata and its Product JSON-LD with Offers (price, currency, availability, condition, url, strikethrough); `app/sitemap.ts` listing products only through a cached read; `app/robots.ts` with the production rule and the block everywhere else. Unit tests for the pure builders and the robots rule, one e2e reading a product page's head, `/sitemap.xml` and `/robots.txt`, satisfies **AC-1**, **AC-2**, **AC-5** to **AC-9**, **AC-11**, **AC-20**
2. Shipping details in each Offer from the cached settings read, with tests for under, at and above the threshold and for no threshold, satisfies **AC-10**
3. Brand card and logo: `brand.colors` in `brand.ts`, the `/brand-card.png` and `/logo.png` route handlers, `app/icon.tsx`; the home, legal and search pages move onto `pageMetadata` (`legalMetadata` removed); a product without photos uses the card; the home page's Organization and WebSite JSON-LD; `/search` keeps its noindex and gets the card, satisfies **AC-3**, **AC-4**, **AC-15**, **AC-17**
4. Listing canonicals: export the page count function from `listing.ts` and use it in `buildListing`; the pure `listingCanonical` with unit tests for every AC-12 case; the category page moves onto `pageMetadata`; home and category `generateMetadata` read `searchParams` and the cached index for the page count; the `, page N` title; category descriptions through `plainExcerpt`; the category BreadcrumbList, satisfies **AC-12**, **AC-13**, **AC-14**, **AC-16**
5. Complete the sitemap: home, legal pages, visible categories, product images; a `test:db` test that drafts, archived products, variant less products and hidden categories are left out; an e2e that a product write and a category write show on the next request, satisfies **AC-18**, **AC-19**
6. Hidden and private pages: e2e that a draft, an archived and an unknown product (one prerendered miss, one product unpublished after build), and a hidden category, render `noindex` with no JSON-LD; a check that the cart, checkout, account, admin and auth pages are still `noindex` and absent from the sitemap. Run Google's Rich Results Test by hand on one product page of a preview build, satisfies **AC-21**, **AC-22**

## Consequences

**Positive**:
- Products become eligible for price, availability and sale rich results, and every share shows a real image.
- Preview deploys and local builds can never be crawled, whatever domain they sit on.
- The sitemap follows the catalog with no deploy, through tags that writes already expire.

**Negative / tradeoffs**:
- The home and category metadata now render at request time (they read `searchParams`), so for normal browsers their head streams in after the shell; crawlers still get it in the head (Next blocks metadata for known bots).
- `updated_at` on a product does not move when only a variant or image changes, so the sitemap's `lastModified` can lag a price change. Search engines treat it as a hint; accepted.
- No return policy or delivery time in the Offer, so Google's merchant listing report will show "missing field" warnings until those have real sources.
- Two direct dependencies (`mdast-util-from-markdown`, `mdast-util-to-string`) and one dev dependency (`schema-dts`) join `package.json`.

**Neutral**:
- Spec 0013 AC-24's "canonical of their plain path, without any query" is narrowed by AC-12 here for unfiltered paged views.
- Organization `sameAs` (social profiles) and GTINs are left out: neither exists in the data.

## Follow-up

- [ ] Spec 0013 AC-24 is partly superseded by AC-12 (paged canonicals); `/sync` can note it in `src/features/catalog/AGENTS.md`.
- [ ] Add a return window and a delivery time as real settings (or brand constants checked against the legal text), then add `hasMerchantReturnPolicy` and `deliveryTime` to the Offer.
- [ ] Before launch, confirm the compare at price shown and marked up as StrikethroughPrice is the lowest price of the previous 30 days (EU Omnibus rule); see `rationale.md`.
- [ ] Feature 19 (production deploy): set `NEXT_PUBLIC_SITE_URL` to the real domain, then submit `/sitemap.xml` in Google Search Console.
- [ ] On the first preview deploy (none yet), run one product page through Google's Rich Results Test, the last open step in `verify.md` (AC-7 to AC-10).
- [ ] `vercel:next-cache-components` and `vercel:nextjs` are Vercel plugin skills not listed in root `AGENTS.md` `## Agent skills`; they belong there if they keep shaping builds.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
