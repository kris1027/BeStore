# Categories

## Overview

Admin only category management: `/admin/categories` (ordered list with product counts, Hidden badge, drag and drop reorder), `/admin/categories/new` and `/admin/categories/<id>` (fields, the category's products with Remove and an "Add products" search, delete). Storefront: the header nav and the category page header and metadata (`/categories/[slug]`, whose listing body comes from catalog), plus arranging the products inside a category. Governing specs: [0009 Admin catalog management](../../../docs/specs/0009-admin-catalog-management/index.md) (AC-17 to AC-21, AC-24), [0013 Categories, search and filters](../../../docs/specs/0013-categories-search-filters/index.md).

## Files

- `schemas.ts`: pure. `categoryFieldsSchema` (name, slug, plain text description, visible) is shared by the form (`zodResolver`) and the actions, plus the per action schemas; `categoryFieldErrors` maps issues to fields.
- `admin-queries.ts`: `getAdminCategories()` and `getCategoryForEdit(id)`, live reads (never cached).
- `queries.ts`: cached storefront reads of visible categories only: `getNavCategories`, `getCategoryBySlug` (null for unknown, malformed or hidden), `getPrerenderedCategorySlugs`.
- `actions/`: `create-category`, `update-category`, `delete-category`, `reorder-categories`, `set-category-products`, `reorder-category-products`.
- `components/`: the list page (built on `src/components/arrange-list.tsx`), the editor, form, product list (with arranging) and delete button; `category-header.tsx` for the storefront page.
- `paths.ts`: admin URLs and `categoryPath`. `log.ts`: `catalog.category.created`, `.updated`, `.deleted`, `.products_reordered`, `catalog.categories.reordered` (ids and counts only, never names or descriptions).

## Conventions

- Every admin page and action calls `requireAdmin()` first; an unknown or malformed id shows the not found state.
- Never import `src/features/catalog/` internals. Linking products goes through `src/lib/product-categories.ts` (`lockCategories`, `linkAtEnd`), which the catalog's Categories section shares; routes compose the two: the admin category page takes `searchProductsForPicker` from catalog, the storefront category page takes `ListingView`.
- A product joins a category at the end (`max(position) + 1`, category row locked first). Adding a link that exists or removing one already gone is a no op, not an error.
- Updates compare `loadedUpdatedAt` under `FOR UPDATE` and return `stale` on a mismatch. Reorder (categories, and products inside a category) takes the full id list, refuses with `stale` unless it is exactly the current set, and rewrites positions `0..n-1` in one raw SQL statement so `updated_at` stays put.
- Deleting removes the category and its links; the products stay unchanged.
- Storefront reads are `'use cache'`, tagged `categories` (`src/lib/cache-tags.ts`); every action here expires it with `updateTag` after the commit, and delete also expires `catalog` (the listing index carries both tags).

## Tests

`schemas.test.ts` beside the schema; actions and reads against a real database in `tests/db/categories.db.test.ts` (`pnpm test:db`); flows in `tests/e2e/catalog/categories-arrange.spec.ts`. The db test mocks `@/lib/logger` through `tests/db/logger-mock.ts`, so `log.ts` gets a `createAdminEventLogger` bound to the mock.

_Drafted from the introducing change (spec 0009), worth a quick human pass._
