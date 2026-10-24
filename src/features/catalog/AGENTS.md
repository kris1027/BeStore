# Catalog

## Overview

Products, option types, variants, ordered image galleries (up to 8, each optionally tied to one option value) and stock history: the admin list, create form, per section edit page and arrange page (`/admin/products`, `/admin/products/<id>`, `/admin/products/arrange`), the storefront listings (home `/`, `/search`, the body of `/categories/[slug]`) and product page (`/products/[slug]`). Governing specs: [0005 Core buy loop](../../../docs/specs/0005-core-buy-loop/index.md), [0009 Admin catalog management](../../../docs/specs/0009-admin-catalog-management/index.md), [0013 Categories, search and filters](../../../docs/specs/0013-categories-search-filters/index.md). Categories themselves live in `src/features/categories/`.

## Files

- `schemas.ts`: the create form schema plus one schema per edit section (`detailsSchema`, `variantsSchema`, `addOptionValueSchema`, `stockSchema`, `imagesSchema`, `productCategoriesSchema`, ...), shared by the forms (`zodResolver`) and the actions; `pathErrors` maps Zod issues to dotted field paths for `setError`.
- `variant-grid.ts`: option types to variant rows (`option_key`, SKU suggestion, the 100 combination limit).
- `picker.ts`, `product-summary.ts`: pure rules for the product page picker and the price range / sold out / on sale state.
- `status.ts`, `variant-edit.ts`, `stock.ts`, `image-edit.ts`: pure edit rules (status transitions and publish position; variant conflicts, renames and new value combinations; stock changes and moved rows; the images conflict check).
- `markdown.tsx`: the one description renderer (`ProductDescription`), shared by the cached product page and the admin Preview, so it has no `server-only` import.
- `paths.ts`: admin and storefront URLs.
- `listing/`: the storefront listings (spec 0013). `index-query.ts` is the one cached listing index; `index-rows.ts`, `listing.ts`, `params.ts`, `pagination.ts`, `format.ts` are pure (index rows, search / filters / counts / sort / paging, the URL state parser and serializer, page links, the product count label); `listing.ts` also exports `inScopeProducts` and `shownPage` for the canonical. `canonical.ts` is the pure home / category canonical and paged title (spec 0018, AC-12 and AC-13), `canonical-query.ts` feeds it the in scope count from the same cached index; `components/` holds `ListingView` and its controls, which the home, search and category routes render.
- `seo.ts`: pure product page metadata (`productSeo`) and Product JSON-LD (`productJsonLd`, one Offer per live variant with shipping), spec 0018. The site wide builders, `pageMetadata` and the env bound `site` / `store` / `storePageMetadata` live in `src/lib/seo/`.
- `queries.ts`: cached storefront reads (`getSitemapProducts` for `app/sitemap.ts` too); `admin-queries.ts`: live admin reads (never cached): the filtered, keyset paged list, `getProductForEdit`, `getStockHistory`, `getArrangeList`, `getCategoryOptions`, `searchProductsForPicker` (also used by the category page route).
- `actions/`: `create-product`, `create-image-upload`, and one per edit section or step: `update-details`, `change-status`, `update-variants`, `add-option-value`, `adjust-stock`, `update-images`, `update-product-categories`, `reorder-products`, `delete-product`.
- `components/editor/`: the edit page sections; `components/` holds the create form, list, arrange page and storefront parts (card, gallery, purchase).
- `log.ts`: the `catalog.product.*`, `catalog.stock.adjusted` and `catalog.products.reordered` events.

## Conventions

- Storefront reads are `'use cache'`, tagged `catalog` and `product:<slug>` (`src/lib/cache-tags.ts`); every action that changes what the storefront shows expires both with `updateTag` after the commit (a slug change expires the old and the new tag; `reorderProducts` only `catalog`). Category membership, order and visibility are tagged `categories`; the listing index carries both `catalog` and `categories`, so `createProduct` and `updateProductCategories` also expire `categories`. Only `active` products enter the cache.
- Listings read the whole sellable catalog once (`getListingIndex`) and search, filter, count and sort it in plain code per request; no query per search. The URL holds the whole state, and `params.ts` turns any input into a valid state, never an error. Search and filter keys fold text through `src/lib/search-text.ts` (not `slugify`). Index variants carry `inStock`, never the count.
- Home and category canonicals come from the parsed `ListingState`, never raw params: a filtered or sorted view points at the plain path, an unfiltered paged one at `?page=N` for the page `shownPage` actually shows (spec 0018, AC-12, which narrows spec 0013 AC-24). No search or filter text ever reaches metadata.
- The product page gets an availability per variant, never the stock count, so counts above the low stock threshold never reach the browser (`src/lib/availability.ts`).
- Prices are typed in major units and converted with `parseMoney` (`src/lib/money.ts`) without floating point math.
- Create and every save are one transaction. Unique violations (23505) map back to the field concerned via `src/lib/db-errors.ts`; invalid input never partly saves.
- Each edit section has its own conflict check against what the page loaded, never a product version: Details compares `products.updated_at`, Variants the edited fields, Images the id set / alt / position / option link, Categories the id set. A mismatch returns `stale` and saves nothing. `position` writes use raw SQL so arranging never bumps `updated_at`.
- Stock is set by compare and set (`UPDATE ... WHERE stock_quantity = expected`); any row that moved rolls back the whole save. Every stock change writes one `stock_movements` row in the same transaction through `src/lib/stock-movements.ts` (`initial` on create and new values, `adjustment` here, `sale` from the order transition).
- Option types are fixed after create; values can be added (new variant rows only for the missing combinations) and renamed, variants archived. An active product always keeps one non archived variant.
- Images go straight from the browser to the `product-images` bucket through a signed upload URL only an admin can get, at a fresh `products/<uuid v7>.<ext>` path (`src/lib/product-image-rules.ts`). Create and `updateProductImages` check the path shape and that the object exists. Removed files are deleted after commit by `src/features/catalog/image-files.ts`, never one an order line still points at.
- Which images a variant shows is `galleryImages` in `src/lib/product-gallery.ts`, shared with the order line photo, so the order keeps the photo the customer saw.
- Delete is only for a non active product no order line ever referenced, re checked under `FOR UPDATE` on the product; `startCheckout` takes `FOR KEY SHARE` on its variants so the two never race.
- Product category links go through `src/lib/product-categories.ts` (`lockCategories`, `linkAtEnd`), shared with `src/features/categories/`; neither feature imports the other.
- Every admin action and every `/admin/products` page call `requireAdmin()` first.

## Tests

Pure rules have `*.test.ts` beside them; actions and queries run against a real database in `tests/db/catalog-*.db.test.ts` (`pnpm test:db`); flows in `tests/e2e/catalog/` and admin denials in `tests/e2e/admin/catalog-denials.spec.ts`.

A db test that loads `log.ts` mocks `@/lib/logger` through `tests/db/logger-mock.ts`: a bare `{ logger }` mock has no `createAdminEventLogger`, so the file fails to load. One that reaches `src/lib/product-image.ts` (through `admin-queries.ts`, for instance) also mocks `@/lib/env`; it passes locally only because `.env.local` fills the app env, and CI has none.

_Drafted by /sync from the introducing change, worth a quick human pass._
