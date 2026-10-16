# 0013. Categories, search and filters

**Date**: 2026-10-16 (amended the same day after a cross check: AC-3, AC-5, AC-6, AC-8, AC-9, AC-11, AC-13 to AC-16, AC-18, AC-20, AC-22 to AC-24, the index shape)
**Status**: In Progress

## Summary

Customers can now find products three ways: a page per visible category (linked from the header), a text search on product names (a box in the header), and the home page, which becomes the full catalog with paging. Every listing gets the same filters (price, option values like size and colour, in stock, on sale) and sort orders, and the URL holds the whole state, so a link shows the same results. To keep it simple at a few hundred products, the whole sellable catalog is read once into one cached list and filtered in plain code on each request, with no schema change and no database query per search. Admins also get to arrange the products inside each category, which sets the category page's default order.

## Requirements

**User stories**:
- As a shopper, I want to open a category from the header so that I see only the kind of product I came for.
- As a shopper, I want to search by product name, without worrying about accents or capitals, so that I find a product I already know.
- As a shopper, I want to filter by price, size, colour, stock and sale, and sort the results, so that I only see what I could buy.
- As a shopper, I want to share or bookmark a filtered list so that whoever opens it sees the same results.
- As an admin, I want to arrange the products inside a category so that the best ones show first.

**Acceptance criteria** (the contract):

*Listings and categories*
- **AC-1**: `/categories/<slug>` for a visible category shows its name, its plain text description, and its listable products as cards in Featured order: `product_categories.position`, then `products.position`, `created_at` newest first, `id` descending.
- **AC-2**: An unknown slug, a malformed slug, or a hidden category renders the store's not found page (status 200 under Cache Components, as the product page already accepts). Only listable products appear in any listing: status `active` with at least one non archived variant. Draft and archived products never appear.
- **AC-3**: The header nav lists every visible category in admin order (`categories.position`), on desktop and in the existing mobile menu. With no visible categories there is no nav and no mobile menu button (`StoreShell` already hides both for an empty list). A visible category with no listable products still renders its name and description (nothing when the description is empty), then "Nothing here yet" with a link to all products, and no filter panel.
- **AC-4**: The home page `/` lists every listable product in Featured order (`products.position`, `created_at` newest first, `id` descending) with the same filters, sorts and paging as a category page. The 48 product cap is gone.
- **AC-5**: Listings show 24 products per page with numbered page links (previous, next, first, last, the current page ±1, gaps as an ellipsis) inside `<nav aria-label="Pagination">`, the current page marked `aria-current="page"`. Page 1 is the URL without `page`. With a single page there is no pagination nav; previous is absent on the first page and next on the last.

*Search*
- **AC-6**: Every storefront page has a labelled search box in the header ("Search products"): always visible on desktop, behind a labelled search button on mobile. It is a GET form to `/search?q=`, so it works without JavaScript. `/search` also shows its own search box, filled with the current query. The query is trimmed, then capped at 100 code points (whole characters, never a split surrogate pair).
- **AC-7**: Search matches product names only. Query and name are folded the same way (lowercase, accents removed, letters with no decomposition mapped: ł→l, ø→o, đ→d, ß→ss, æ→ae, œ→oe) and split into words on anything that is not a letter or digit. A product matches when every query word is the start of some word in its name. So `kosciol` finds "Kościół", `blu tee` finds "Blue Tee", `TEE` finds "Tee", and `tee` does not find "Settee".
- **AC-8**: Search results default to Best match: products whose name words, joined by single spaces, start with the query words joined the same way come first (so `t-shirt` ranks "T Shirt" first), then every other match; ties in Featured order (`products.position`, then as AC-4).
- **AC-9**: A query shorter than 2 code points after trimming (including none), or one with no words after folding (such as `!!`), shows "Type at least 2 characters to search" under the box, no results and no filters.
- **AC-10**: Search text is never logged and never sent to any other service. No log line is written per search or per listing view.

*Filters*
- **AC-11**: Every listing whose scope has products before filters (home, category, search with a valid query) offers, even when the active filters leave 0 results: a price range (Min and Max inputs in major units, inclusive), one checkbox group per option type, "In stock only", and "On sale only".
- **AC-12**: Variant filters apply to one variant at a time. A product matches when at least one non archived variant satisfies every active filter together: its value in each filtered option group is one of the selected values (OR inside a group, AND across groups); its `price_cents` is within the range; it is in stock (`stock_quantity > 0`) when "In stock only" is on; it is in stock with a compare at price when "On sale only" is on. A product without a filtered option type never matches that filter.
- **AC-13**: Option groups come from the listing's products before filters (after search). Option type names and values are grouped by a folded key (the AC-7 fold, then runs of anything but Unicode letters and digits become one `-`, trimmed), so "Colour", "colour " and "COLOUR" are one group, "Red" and "red" one value, and Cyrillic names keep a key. A type or value whose key is empty is skipped. Inside one product, two types with the same key merge into one, and a variant counts each value key once. Each group and value shows its most common spelling. Groups are ordered by how many products have them, then by label; values by first appearance when walking the listing's products in Featured order, each product's values in admin position order. A group with a single value is not shown. A group whose key equals a reserved param (`q`, `sort`, `page`, `min`, `max`, `stock`, `sale`) is not offered.
- **AC-14**: Each option value shows how many products would match with it added to the other active filters (the counts for one group ignore that group's own selection). "In stock only" and "On sale only" show the count with that toggle on and every other active filter applied. A value with count 0 is shown but disabled, unless it is already selected. A product counts once per value, so the counts inside one group may add up to more than the total; that is intended.
- **AC-15**: The Min and Max inputs are labelled with the store currency, parsed with `parseMoney` (no floating point; `0` is valid), and show the lowest and highest non archived variant price of the scope before filters as placeholders (the same value in both when all prices are equal). A dropped value leaves its input empty.

*Sorting and URL*
- **AC-16**: A labelled "Sort by" select offers Featured (`featured`), Newest (`newest`, by `created_at`), Price low to high (`price-asc`), Price high to low (`price-desc`), both by the product's lowest non archived variant price, and Name A to Z (`name`, `Intl.Collator` for `STORE_LOCALE`). `/search` also offers Best match (`relevance`), its default; Featured is the default elsewhere and `relevance` is ignored there. The default is never written to the URL. Ties keep the listing's default order.
- **AC-17**: The URL carries the whole state: `q`, `sort`, `page`, `min`, `max`, `stock=1`, `sale=1`, and one repeated key per option group (`?size=m&color=red&color=blue`, keys and values in folded slug form). Defaults are left out, and params always serialize in one stable order, so one state has one URL. Opening a shared URL renders the same results. Any filter or sort change resets to page 1.
- **AC-18**: Bad params are repaired or dropped silently, never an error page: min above max are swapped; an unparsable or negative price is dropped; unknown keys, unknown values and an unknown sort are ignored (default sort); a repeated scalar param keeps its first value; a non numeric page is 1 and a page past the end renders the last page (no redirect); at most 10 option groups and 20 values per group are read. The controls show what was actually applied.

*Filter UI*
- **AC-19**: With JavaScript, each change updates the URL and the results without a full page load: checkboxes and sort at once, prices on blur or Enter. The browser Back button undoes the last change. Without JavaScript the panel is a GET form with an Apply button (only shown when JavaScript is off).
- **AC-20**: Filters sit in a sidebar on desktop. On small screens a "Filters" button showing the active filter count opens them in a Sheet, which stays open and keeps focus while changes apply. The count adds one per selected value, per price bound and per toggle. On both, active filters show as removable chips above the grid ("Colour: Red", "Min 10 zł", "Max 50 zł", "In stock", "On sale", labels in their most common spelling and prices in the store format), with "Clear all" (which keeps `q`). The result count ("12 products") sits in a polite live region.
- **AC-21**: With no results: "No products match." When filters are on, a "Clear filters" link (keeps `q`). On a search, "Try fewer or shorter words" and a link to all products.

*Caching, admin and SEO*
- **AC-22**: The listing index is one `'use cache'` read tagged `catalog` and `categories`. Category reads (nav, category page) are tagged `categories`. Every category write expires `categories` with `updateTag` after its commit: create, update, delete, reorder categories, set category products, the new arrange action (AC-23), the product editor's `updateProductCategories`, and `createProduct` (it links categories through `linkAtEnd`). A change shows on the next request. Page shells stay static; the results, which read `searchParams`, render behind Suspense.
- **AC-23**: On `/admin/categories/<id>` the existing product list (all statuses, loaded in `position` order, Remove and "Add products" kept) becomes the shared sortable list: drag and drop or keyboard, then an explicit Save order button. Remove or Add while the order is unsaved warns, then discards the draft order. On `stale` the page shows a notice and reloads the current list. Saving rewrites `product_categories.position` to `0..n-1` in one raw SQL statement, and refuses with `stale` unless the id list is exactly the category's current set (category row locked first). The page and the action call `requireAdmin()`. It logs `catalog.category.products_reordered` with ids and counts only. The category page's Featured order follows it.
- **AC-24**: A category page's title is `meta_title`, else the name; its description is `meta_description`, else its description. Home keeps its title; `/search` is titled "Search", and query text never appears in any title or metadata. `/search` is `noindex, follow`. The home and category pages declare a canonical URL of their plain path, without any query.
- **AC-25**: WCAG AA on every new surface: labelled search inputs, each filter group a `fieldset` with a `legend`, labelled price inputs and sort select, the panel and Sheet fully keyboard operable with visible focus. axe passes on home, a category page and `/search`, with the filters open.

## Decision

**Chosen option**: Option 1: one cached listing index, filtered in pure code

Read every listable product once into a cached index tagged `catalog` and `categories`, and do search, filters, counts, sort and paging as pure functions per request; no schema change.

**Implementation skills**: `vercel:next-cache-components` (Vercel plugin) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `accessibility` (`.agents/skills/accessibility/`) · `playwright-best-practices` (`.agents/skills/playwright-best-practices/`) · `next-dev-loop` (`.agents/skills/next-dev-loop/`)

**Calls made in this spec** (pick, why, runner up):
- **Fold text in our own `foldText`, not `slugify`.** `slugify` turns ł into a separator ("Kościół" → `koscio`), so search and facet keys need an explicit map after NFKD. Runner up: Postgres `unaccent` (needs SQL per query, which Option 1 avoids).
- **The index stores `inStock` as a boolean, never `stock_quantity`.** Keeps the spec 0005 rule that counts never leave the server, even if a later change sends index rows to the client. Runner up: store the count and convert at render.
- **`createdAt` as epoch milliseconds in the index.** Plain numbers survive the cache serializer with no surprises. Runner up: `Date`.
- **Price sort by the lowest non archived variant price**, the same "from" price the card shows, not the lowest filtered variant. The order matches what the shopper reads. Runner up: lowest matching variant price.
- **Filter changes use `router.push` with `scroll: false`** inside a transition, so Back undoes a filter (AC-19). Runner up: `router.replace`, which keeps history short but makes Back leave the page.
- **The header search box never prefills.** Prefilling needs `useSearchParams` in the layout and a Suspense boundary in every page's header; `/search` has its own prefilled box instead. Runner up: a prefilled header box behind Suspense.
- **Canonical is the plain path for every paged URL too** (as you chose). Page 2 and on are then a hint, not indexed on their own; feature 17 can revisit this with the sitemap.
- **Arranging lives on the existing category edit page**, reusing `src/components/arrange-list.tsx`, not a separate `/arrange` route. Runner up: a separate arrange page like products.
- **New listing code lives in `src/features/catalog/listing/`** (products are the catalog's), category reads in `src/features/categories/queries.ts`, and route files compose the two. No feature imports the other.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

- `src/lib/search-text.ts` (pure): `foldText(text)` (lowercase, NFKD, strip combining marks, the AC-7 map), `searchWords(text)` (folded words, split on anything but `\p{L}\p{N}`), `facetKey(text)` (folded, non `\p{L}\p{N}` runs to `-`, trimmed; may be empty, callers skip it).
- `src/lib/cache-tags.ts`: add `categoriesTag = "categories"`.
- `src/features/catalog/listing/index-query.ts` (`server-only`): `getListingIndex()`, `'use cache'`, `cacheLife("max")`, tags `catalog` and `categories`.
- `src/features/catalog/listing/params.ts` (pure): `parseListingParams(searchParams, kind)` (Zod, AC-18) → `ListingState`; `listingHref(path, state)` (AC-17 stable order).
- `src/features/catalog/listing/listing.ts` (pure): `buildListing(index, scope, state)` → results page, total, page count, option groups with counts, toggle counts, price bounds, the applied state. Internally `matchSearch`, `rankSearch`, `matchVariant`, `facetGroups`, `sortProducts`, `paginate`.
- `src/features/catalog/listing/components/`: `listing-view.tsx` (server, inside Suspense), `filter-panel.tsx` (client, form + instant apply), `filter-sheet.tsx`, `active-filters.tsx`, `sort-select.tsx`, `pagination.tsx`, `listing-empty.tsx`, `search-box.tsx` (header, client only for the mobile toggle).
- `src/features/categories/queries.ts` (`server-only`, cached, tag `categories`): `getNavCategories()`, `getCategoryBySlug(slug)`, `getPrerenderedCategorySlugs()`.
- `src/features/categories/actions/reorder-category-products.ts`, plus `updateTag(categoriesTag)` added to every category action and to the catalog's `update-product-categories.ts`.
- Routes: `app/(store)/page.tsx` (home listing), `app/(store)/categories/[slug]/page.tsx` (its `generateStaticParams` falls back to a placeholder slug when no category is visible, like the product page), `app/(store)/search/page.tsx` (the prefilled box reads `searchParams`, so it sits inside the Suspense boundary with the results; `generateMetadata` never reads `searchParams` on any of the three); `app/(store)/layout.tsx` passes the nav categories and the search box to `StoreShell`. The old `getActiveProducts` and `HOME_PRODUCT_LIMIT` go away once nothing reads them.

### Data model sketch

No migration. Read only, except `product_categories.position`:

| Table | Read for | Written |
|---|---|---|
| `products` (status `active`) | `id`, `name`, `slug`, `position`, `created_at`, first image | no |
| `product_variants` (`archived = false`) | `price_cents`, `compare_at_price_cents`, `stock_quantity > 0` | no |
| `product_option_types`, `product_option_values`, `variant_option_values` | names, values, positions, each variant's values | no |
| `categories` (`visible = true`) | `id`, `name`, `slug`, `description`, `position`, `meta_title`, `meta_description` | no |
| `product_categories` | membership, `position` (category Featured order) | `position`, by AC-23 |

The index (in memory, per cache entry) is a read only list of:

```ts
type ListingProduct = {
  readonly id: string; readonly name: string; readonly slug: string;
  readonly nameWords: readonly string[];      // searchWords(name); joined by " " for Best match
  readonly position: number; readonly createdAtMs: number;
  readonly image: ProductImage;
  readonly categoryPositions: Readonly<Record<string, number>>; // categoryId → position
  // Stored once per product (types merged by key, empty keys skipped), referenced by index,
  // so labels are not repeated on every variant and the cache entry stays small.
  readonly optionTypes: readonly { key: string; label: string;
                                   values: readonly { key: string; label: string }[] }[];
  readonly variants: readonly {
    readonly priceCents: number; readonly compareAtPriceCents: number | null;
    readonly inStock: boolean;
    readonly valueIndexes: readonly (readonly [type: number, value: number])[]; // deduped by key
  }[];
};
```

The card fields (`minPriceCents`, `maxPriceCents`, `soldOut`, `onSale`) are derived from `variants` with the existing `summarizeVariants` / `isOnSale` rules, at read time.

### State transitions

None.

### API surface

| Surface | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/` | GET | `sort`, `page`, `min`, `max`, `stock`, `sale`, option keys | listing page | public | none (bad params repaired, AC-18) |
| `/categories/[slug]` | GET | `slug` (path), same query params | category header + listing | public | not found UI for unknown, malformed or hidden slug (AC-2) |
| `/search` | GET | `q` (≤100 chars), same query params | search box + listing, `noindex` | public | prompt when `q` < 2 chars (AC-9) |
| `getListingIndex()` | cached read | none | `readonly ListingProduct[]` | server only | none |
| `getNavCategories()` | cached read | none | `{ name, slug }[]` in `position` order | server only | none |
| `getCategoryBySlug(slug)` | cached read | `slug` | `{ id, name, slug, description, metaTitle, metaDescription } \| null` | server only | `null` for unknown, hidden or malformed |
| `reorderCategoryProducts` | server action | `categoryId: uuid` (req), `productIds: uuid[]` (req) | `{ ok: true }` | `requireAdmin()` | `stale` (set differs or category gone), `invalid` |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Category page | name, description | `categories.name`, `categories.description` |
| Category page | Featured order | `product_categories.position`, then `products.position`, `created_at` desc, `id` desc |
| Home | Featured order | `products.position`, `created_at` desc, `id` desc |
| Search | Best match tier | `nameWords.join(" ").startsWith(searchWords(q).join(" "))` from the index |
| Home, search | page title | fixed: home keeps its current title, `/search` is "Search" |
| Filters button, chips | active count, chip labels | one per selected value, price bound and toggle; group and value labels from the index, prices via the store money format |
| Header nav | categories and order | `categories` where `visible`, by `position` |
| Card | image, price range, sold out, sale badge | first image by position; `summarizeVariants` and `isOnSale` over the index variants |
| Option group | key, label, order | `facetKey(product_option_types.name)`; most common spelling; product count desc, then label |
| Option value | key, label, order | `facetKey(product_option_values.value)`; most common spelling; first appearance in Featured order by `product_option_values.position` |
| Value count | number | `buildListing` over the scope with all filters except that group plus that value |
| Price placeholders | lowest, highest | min / max `price_cents` of non archived variants in the scope before filters, formatted in `STORE_CURRENCY` / `STORE_LOCALE` |
| Price filter | cents | `min` / `max` params through `parseMoney` |
| Newest sort | date | `products.created_at` (as `createdAtMs`) |
| Price sort | price | lowest non archived `price_cents` (the card's "from" price) |
| Name sort | collation | `Intl.Collator(env.STORE_LOCALE)` |
| Result count | number | `buildListing` total |
| Page count | number | `ceil(total / 24)`, at least 1 |
| Category metadata | title, description | `meta_title ?? name`, `meta_description ?? description` |
| Canonical | URL | the route's plain path (`/`, `/categories/<slug>`) |
| Arrange save | positions | index in the submitted `productIds` list, `0..n-1` |

### Key invariants

- Only `active` products with a non archived variant enter the index; only `visible` categories are readable on the storefront.
- The index and every value sent to the browser carry stock only as a boolean or an availability, never `stock_quantity`.
- Search, filters, counts, sort and paging are pure functions of (index, scope, state): no I/O, no `Date.now()`, no randomness. The same URL gives the same page for a given index.
- Every write that changes category membership, order or visibility expires `categories` after commit (deletes that cascade links also expire `catalog`, which the index carries too); every write that changes product data already expires `catalog`.
- `product_categories.position` is rewritten as a contiguous `0..n-1` by the arrange action; `linkAtEnd` keeps appending after the max.
- `parseListingParams` never throws: every input maps to a valid `ListingState`.

### Security model

- Storefront pages and reads are public and expose only data already public on product pages. No auth, no personal data.
- Every input comes from the URL and passes through Zod in `parseListingParams`; search text is matched in memory, never interpolated into SQL.
- The arrange page and `reorderCategoryProducts` call `requireAdmin()` first; ids validated as UUIDs.
- Search text is treated as possibly personal (shoppers paste emails into boxes): never logged (AC-10).
- Rate limiting: a search costs an in memory filter over a cached list, no database round trip, so no new limiter. The production deploy (feature 19) may add a Vercel Firewall rule if abuse shows up.

### Observability

Only `catalog.category.products_reordered` (category id, product count) is new. No per request logs on storefront listings (AC-10). Index build failures surface through the existing error logging.

### Configuration required

None. Uses the existing `STORE_LOCALE` and `STORE_CURRENCY`.

### Critical test scenarios

- Happy path: open a category from the header, filter Color = Red and Size = M, sort by price low to high, open page 2, copy the URL into a fresh context and see the same results, verifies **AC-1**, **AC-3**, **AC-12**, **AC-16**, **AC-17**, **AC-5**.
- Per variant match: a product with Red S and Blue M is excluded by Red + M, included by Red + S; with "In stock only", a sold out Red S drops it, verifies **AC-12**.
- Facets: "colour" and "Colour " merge with the most common label; counts ignore the group's own selection; a 0 count value is disabled, verifies **AC-13**, **AC-14**.
- Search folding: `kosciol` finds "Kościół", `tee` does not find "Settee", a 1 character query shows the prompt, verifies **AC-7**, **AC-9**.
- Bad params: `?min=50&max=10&page=999&sort=zzz&color=nope` renders the last page, swapped range, default sort, no error, verifies **AC-18**.
- Cache expiry: hiding a category removes it from the nav and makes its page not found on the next request; linking a product from the product editor adds it to the category page, verifies **AC-2**, **AC-22**.
- Concurrency: arranging while another admin adds a product to the category returns `stale` and saves nothing, verifies **AC-23**.
- Auth/permission: a customer or signed out visitor calling `reorderCategoryProducts` is refused by `requireAdmin()`, and the admin page redirects through the proxy, verifies **AC-23**.
- No JavaScript: the filter form submits with Apply and the search box submits as GET, verifies **AC-6**, **AC-19**.
- Accessibility: axe and a keyboard only pass through the panel, Sheet, sort and pagination, verifies **AC-25**.

## Build plan

Tracer Bullet: milestone 1 runs one category listing through every layer (cached reads, tags, route, component, nav); each later milestone thickens one segment and ships end to end.

**Milestone 1, thin thread: category pages and the cached index**
1. [x] Add `categoriesTag`; add `updateTag(categoriesTag)` after commit to create, update, delete, reorder categories, set category products, `updateProductCategories` and `createProduct`, satisfies **AC-22**
2. [x] `getListingIndex()` with the `ListingProduct` shape (no options yet beyond what the card needs), plus a db test that drafts, archived products and archived variants are out and stock is a boolean, satisfies **AC-2**, **AC-22**. Once options land (task 10), the db test also seeds about 500 products and asserts the serialized index stays well under the cache entry limit
3. [x] `getNavCategories`, `getCategoryBySlug`, `getPrerenderedCategorySlugs`; header nav from `StoreShell` `navItems`, satisfies **AC-3**
4. [x] Pure `buildListing` for category scope with Featured order and paging, `parseListingParams` for `page` only, `listingHref`; unit tests, satisfies **AC-1**, **AC-5**, **AC-18**
5. [x] `/categories/[slug]` route with Suspense, not found state, empty category state, pagination component, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**

**Milestone 2, home and search**
6. [x] Home becomes the listing (all scope); remove `getActiveProducts` and the 48 cap, satisfies **AC-4**
7. [x] `src/lib/search-text.ts` with unit tests (ł, ß, combining marks, prefix rule), satisfies **AC-7**
8. [x] Search scope and Best match ranking in `buildListing`; `/search` route with its own box, prompt under 2 characters, `noindex`, satisfies **AC-8**, **AC-9**, **AC-24**
9. [x] Header search box (desktop inline, mobile toggle), GET form, no logging anywhere on the path, satisfies **AC-6**, **AC-10**

**Milestone 3, filters and sort**
10. [x] Option data in the index; `facetKey` grouping, labels, ordering, reserved key rule, satisfies **AC-13**
11. [x] Per variant matching (options, price, stock, sale), disjunctive counts, price bounds; full `parseListingParams` repair rules and stable serialization; unit tests for each rule, satisfies **AC-12**, **AC-14**, **AC-15**, **AC-17**, **AC-18**
12. [x] Sort select and sort functions (collator from `STORE_LOCALE`), satisfies **AC-16**
13. [x] Filter panel (GET form, instant apply with `router.push`, prices on blur or Enter), Sheet on small screens, chips with Clear all, live result count, no results states, satisfies **AC-11**, **AC-19**, **AC-20**, **AC-21**

**Milestone 4, admin arrange within a category**
14. [x] `reorderCategoryProducts` (lock, exact set check, raw SQL positions, log, `updateTag`), db tests for ok and `stale`; sortable product list on `/admin/categories/<id>`, satisfies **AC-23**, **AC-22**

**Milestone 5, safety net**
15. [x] Category metadata, canonical URLs on home and category pages, satisfies **AC-24**
16. [x] e2e: the happy path, bad params, no JS form, cache expiry after admin edits, arrange then storefront order, admin denial; axe and keyboard on home, category and search with filters open, satisfies **AC-1** to **AC-25**

## Consequences

**Positive**:
- No schema change, no new service, no new env var; reads reuse existing cache tags plus one new one.
- All discovery rules are pure and unit testable; a search never touches the database.
- The home page finally pages, and the header nav stops being empty.

**Negative / tradeoffs**:
- The whole sellable catalog sits in one cache entry and is scanned per request. Fine under 500 products; above about 2,000 the entry size and per request CPU call for SQL per request (Follow-up).
- Any product or category write rebuilds the whole index on the next request, not just the changed product.
- No typo tolerance: `tshirt` will not find "T Shirt" unless the name says it. Name only search misses products whose name lacks the word a shopper uses.
- Home, category and search pages now render their results per request (behind Suspense) instead of being fully cached HTML, so they cost a function run each.
- Canonical to the plain path means paged and filtered views are never indexed on their own.
- Option matching relies on admins using the same option names across products; "Colour" and "Color" stay two groups.

**Neutral**:
- `getActiveProducts` and `HOME_PRODUCT_LIMIT` are removed; the spec 0005 Follow-up about home paging closes.
- `src/features/catalog/listing/` is a new subfolder; `src/features/categories/` gains its first storefront reads.
- A not found category answers 200, like products today.

## Follow-up

- [ ] If the catalog passes about 2,000 active products, or the index entry nears the cache size limit, move matching to SQL per request (`pg_trgm` and `unaccent` indexes); the pure `buildListing` contract stays as the test oracle.
- [ ] Feature 17 (SEO): sitemap entries for categories, `ItemList` structured data, and whether paged URLs should canonicalize to themselves.
- [ ] Feature 18 (analytics): search terms and zero result searches, with consent, if the store wants to learn what people look for.
- [ ] Consider an admin hint when two products use option names that fold differently but mean the same ("Colour" vs "Color").
- [ ] Spec 0009 Follow-up (categories cache tag, category product order view) is closed by AC-22 and AC-23.
- [ ] `src/features/catalog/AGENTS.md` and `src/features/categories/AGENTS.md` still say category actions expire nothing; they go stale once AC-22 lands (for /sync).
- [ ] `vercel:next-cache-components` is a plugin skill, not listed in root `AGENTS.md` `## Agent skills`; it belongs there next to the caching rule.
