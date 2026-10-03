# Catalog

## Overview

Products, option types, variants, ordered image galleries (up to 8, each optionally tied to one option value) and stock history: the admin list, create form, per section edit page and arrange page (`/admin/products`, `/admin/products/<id>`, `/admin/products/arrange`), the storefront home grid (`/`) and product page (`/products/[slug]`). Governing specs: [0005 Core buy loop](../../../docs/specs/0005-core-buy-loop/index.md), [0009 Admin catalog management](../../../docs/specs/0009-admin-catalog-management/index.md). Categories themselves live in `src/features/categories/`.

## Files

- `schemas.ts`: the create form schema plus one schema per edit section (`detailsSchema`, `variantsSchema`, `addOptionValueSchema`, `stockSchema`, `imagesSchema`, `productCategoriesSchema`, ...), shared by the forms (`zodResolver`) and the actions; `pathErrors` maps Zod issues to dotted field paths for `setError`.
- `variant-grid.ts`: option types to variant rows (`option_key`, SKU suggestion, the 100 combination limit).
- `picker.ts`, `product-summary.ts`: pure rules for the product page picker and the price range / sold out / on sale state.
- `status.ts`, `variant-edit.ts`, `stock.ts`, `image-edit.ts`: pure edit rules (status transitions and publish position; variant conflicts, renames and new value combinations; stock changes and moved rows; the images conflict check).
- `markdown.tsx`: the one description renderer (`ProductDescription`), shared by the cached product page and the admin Preview, so it has no `server-only` import.
- `paths.ts`: admin and storefront URLs.
- `queries.ts`: cached storefront reads; `admin-queries.ts`: live admin reads (never cached): the filtered, keyset paged list, `getProductForEdit`, `getStockHistory`, `getArrangeList`, `getCategoryOptions`, `searchProductsForPicker` (also used by the category page route).
- `actions/`: `create-product`, `create-image-upload`, and one per edit section or step: `update-details`, `change-status`, `update-variants`, `add-option-value`, `adjust-stock`, `update-images`, `update-product-categories`, `reorder-products`, `delete-product`.
- `components/editor/`: the edit page sections; `components/` holds the create form, list, arrange page and storefront parts (grid, card, gallery, purchase).
- `log.ts`: the `catalog.product.*`, `catalog.stock.adjusted` and `catalog.products.reordered` events.

## Conventions

- Storefront reads are `'use cache'`, tagged `catalog` and `product:<slug>` (`src/lib/cache-tags.ts`); every action that changes what the storefront shows expires both with `updateTag` after the commit (a slug change expires the old and the new tag; `reorderProducts` only `catalog`). The categories actions expire nothing: no cached read uses categories yet. Only `active` products enter the cache.
- The product page gets an availability per variant, never the stock count, so counts above the low stock threshold never reach the browser (`src/lib/availability.ts`).
- Prices are typed in major units and converted with `parseMoney` (`src/lib/money.ts`) without floating point math.
- Create and every save are one transaction. Unique violations (23505) map back to the field concerned via `src/lib/db-errors.ts`; invalid input never partly saves.
- Each edit section has its own conflict check against what the page loaded, never a product version: Details compares `products.updated_at`, Variants the edited fields, Images the id set / alt / position / option link, Categories the id set. A mismatch returns `stale` and saves nothing. `position` writes use raw SQL so arranging never bumps `updated_at`.
- Stock is set by compare and set (`UPDATE ... WHERE stock_quantity = expected`); any row that moved rolls back the whole save. Every stock change writes one `stock_movements` row in the same transaction through `src/lib/stock-movements.ts` (`initial` on create and new values, `adjustment` here, `sale` from the order transition).
- Option types are fixed after create; values can be added (new variant rows only for the missing combinations) and renamed, variants archived. An active product always keeps one non archived variant.
- Images go straight from the browser to the `product-images` bucket through a signed upload URL only an admin can get, at a fresh `products/<uuid v7>.<ext>` path (`src/lib/product-image-rules.ts`). Create and `updateProductImages` check the path shape and that the object exists. Removed files are deleted after commit by `src/lib/product-image-files.ts`, never one an order line still points at.
- Which images a variant shows is `galleryImages` in `src/lib/product-gallery.ts`, shared with the order line photo, so the order keeps the photo the customer saw.
- Delete is only for a non active product no order line ever referenced, re checked under `FOR UPDATE` on the product; `startCheckout` takes `FOR KEY SHARE` on its variants so the two never race.
- Product category links go through `src/lib/product-categories.ts` (`lockCategories`, `linkAtEnd`), shared with `src/features/categories/`; neither feature imports the other.
- Every admin action and every `/admin/products` page call `requireAdmin()` first.

## Tests

Pure rules have `*.test.ts` beside them; actions and queries run against a real database in `tests/db/catalog-*.db.test.ts` (`pnpm test:db`); flows in `tests/e2e/catalog/` and admin denials in `tests/e2e/admin/catalog-denials.spec.ts`.

_Drafted by /sync from the introducing change, worth a quick human pass._
