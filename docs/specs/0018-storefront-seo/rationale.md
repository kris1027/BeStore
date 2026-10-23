# 0018. Storefront SEO: rationale

The decision record behind [index.md](index.md). `/develop` builds from `index.md` and skips this file.

## Context

> ⚠️ Premise note: the StrikethroughPrice markup repeats the "Was" price to search engines, where it shows next to the price in results. Under the EU Omnibus rule (in force in Poland), a shown earlier price must be the lowest price of the previous 30 days, but `compare_at_price_cents` is free admin input with no history behind it. The markup does not create the risk (the product page already shows the "Was" price), it widens where the claim appears. The right framing is to keep the markup, which mirrors the page, and treat the 30 day rule as a pricing policy to confirm before launch (Follow-up).

BeStore is a single brand shop selling in one country, built on Next.js 16 with Cache Components. Its catalog pages already render on the server and most of their shells prerender, so crawlers see real HTML. What is missing is everything that tells a search engine and a share preview what a page is: products have only a title, nothing has a share image, there is no sitemap or `robots.txt`, and there is no structured data. Spec 0013 already set titles and plain canonicals on home and category pages, made `/search` `noindex, follow`, and left open whether paged URLs canonicalize to themselves.

The forces: the store must be findable at launch (scope feature 17); hidden products and private pages must never show up in search; preview deploys run against test catalogs on Vercel URLs and must not compete with the real store; and structured data must never contradict the page, because Google penalizes markup that disagrees with what the shopper sees. The catalog changes without deploys, so anything listing products must follow the cache tags writes already expire. Under Cache Components a page's `notFound()` answers 200, so a hidden product's URL relies on a `noindex` tag rather than a status code.

The data has limits that shape the markup: variants share one URL (the picker has no URL param), the "Was" price is a free admin field, the delivery fee and free threshold live in `store_settings`, and there is no return window, delivery time, GTIN or logo in the data. Leaving this undecided means a launch with no rich results, text only share cards, and a real chance of preview catalogs being indexed.

## Options considered

### Option 1: Next.js metadata files plus one shared helper and pure JSON-LD builders

Use `generateMetadata`, `sitemap.ts`, `robots.ts` and `icon.tsx`, plus two fixed path image routes (the brand card and the logo) built with next/og. One helper builds every page's metadata the same way; pure functions build JSON-LD from the cached reads the pages already make.

**Pros**:
- Nothing new to run; every piece is a Next convention the build already prerenders and caches.
- Pure builders are trivial to unit test, and the helper keeps Open Graph consistent (Next replaces a child's `openGraph` object wholesale, so a helper avoids half filled cards).
- The sitemap follows the existing `catalog` and `categories` tags with no extra invalidation.

**Cons**:
- Listing metadata reading `searchParams` defers to request time.
- Every page must set its share image explicitly, because Next merges metadata objects shallowly.

### Option 2: A metadata library (such as `next-seo`) over the App Router

Adopt a community package that wraps metadata and JSON-LD components.

**Pros**:
- Ready made JSON-LD components for Product, Breadcrumb and Organization.

**Cons**:
- The App Router's own metadata API now covers what these packages were built for; the package adds a layer that lags Next releases (this is Next 16 with breaking changes).
- Its components still need our data mapping, which is the real work.

### Option 3: Static sitemap and robots generated at build

A build script writes `public/sitemap.xml` and `public/robots.txt`.

**Pros**:
- Dead simple files, easy to inspect.

**Cons**:
- The sitemap goes stale on every catalog edit until the next deploy, which breaks the "no deploy" property the rest of the store holds.
- The environment rule has to be repeated in a script.

## Rationale

Option 1 wins on the force that matters most for a catalog managed without deploys: the sitemap and the structured data follow the same cached reads and tags as the pages, so they cannot drift from what shoppers see. It adds no service and no library beyond two small Markdown utilities and a types only package. Option 2 solves a problem the framework already solved, and Option 3 breaks freshness.

Inside Option 1 the shape of the product markup follows the data. A ProductGroup would describe variants best, but Google expects a distinct URL per variant, and adding one would turn the product page into a request time page for a modest gain. One Product with one Offer per variant gives per variant price and availability, which is what rich results actually show. The strikethrough price mirrors the page exactly (the same rule as the "Was" label), and the shipping rate is computed per offer so a product above the free threshold is not shown with a fee it never pays.

On canonicals, pointing page 2 at page 1 tells search engines that deeper pages are duplicates, which cuts the crawl path to products only reachable there; self canonical paged URLs fix that, while filtered and sorted views collapse to the plain path because their content is a subset in another order, not a page of their own. Blocking crawling by default everywhere but production makes the safe state the one that needs no action, with Vercel's own preview header as a second layer.
