# Catalog

## Overview

Products, option types, variants and the one product image: the admin list and create form (`/admin/products`), the storefront home grid (`/`) and product page (`/products/[slug]`). Governing spec: [0005 Core buy loop](../../../docs/specs/0005-core-buy-loop/index.md).

## Files

- `schemas.ts`: the create form schema, shared by the form (`zodResolver`) and `actions/create-product.ts`; `pathErrors` maps Zod issues to dotted field paths for `setError`.
- `variant-grid.ts`: option types to variant rows (`option_key`, SKU suggestion, the 100 combination limit).
- `picker.ts`, `product-summary.ts`: pure rules for the product page picker and the price range / sold out state.
- `queries.ts`: cached storefront reads; `admin-queries.ts`: the live admin list (never cached).
- `actions/create-product.ts`, `actions/create-image-upload.ts`: the admin actions; `log.ts`: `catalog.product.created`.

## Conventions

- Storefront reads are `'use cache'`, tagged `catalog` and `product:<slug>` (`src/lib/cache-tags.ts`); `createProduct` expires both with `updateTag`. Only `active` products enter the cache.
- The product page gets an availability per variant, never the stock count, so counts above the low stock threshold never reach the browser (`src/lib/availability.ts`).
- Prices are typed in major units and converted with `parseMoney` (`src/lib/money.ts`) without floating point math.
- Create is one transaction. Unique violations (23505) map back to the field concerned via `src/lib/db-errors.ts`; invalid input never partly saves.
- Images go straight from the browser to the `product-images` bucket through a signed upload URL only an admin can get, at a fresh `products/<uuid v7>.<ext>` path (`src/lib/product-image-rules.ts`). `createProduct` checks the path shape and that the object exists.
- Both admin actions and every `/admin/products` page call `requireAdmin()` first.

## Tests

Pure rules have `*.test.ts` beside them; actions and queries run against a real database in `tests/db/catalog-*.db.test.ts` (`pnpm test:db`); flows in `tests/e2e/catalog/`.

_Drafted by /sync from the introducing change, worth a quick human pass._
