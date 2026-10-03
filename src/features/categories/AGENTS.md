# Categories

## Overview

Admin only category management: `/admin/categories` (ordered list with product counts, Hidden badge, drag and drop reorder), `/admin/categories/new` and `/admin/categories/<id>` (fields, the category's products with Remove and an "Add products" search, delete). Storefront category pages come with feature 13 and will add their reads here. Governing spec: [0009 Admin catalog management](../../../docs/specs/0009-admin-catalog-management/index.md) (AC-17 to AC-21, AC-24).

## Files

- `schemas.ts`: pure. `categoryFieldsSchema` (name, slug, plain text description, visible) is shared by the form (`zodResolver`) and the actions, plus the per action schemas; `categoryFieldErrors` maps issues to fields.
- `admin-queries.ts`: `getAdminCategories()` and `getCategoryForEdit(id)`, live reads (never cached).
- `actions/`: `create-category`, `update-category`, `delete-category`, `reorder-categories`, `set-category-products`.
- `components/`: the list page (built on `src/components/arrange-list.tsx`), the editor, form, product list and delete button.
- `paths.ts`: admin URLs. `log.ts`: `catalog.category.created`, `.updated`, `.deleted`, `catalog.categories.reordered` (ids and counts only, never names or descriptions).

## Conventions

- Every page and action calls `requireAdmin()` first; an unknown or malformed id shows the not found state.
- Never import `src/features/catalog/` internals. Linking products goes through `src/lib/product-categories.ts` (`lockCategories`, `linkAtEnd`), which the catalog's Categories section shares; the category page route composes `searchProductsForPicker` from catalog itself.
- A product joins a category at the end (`max(position) + 1`, category row locked first). Adding a link that exists or removing one already gone is a no op, not an error.
- Updates compare `loadedUpdatedAt` under `FOR UPDATE` and return `stale` on a mismatch. Reorder takes the full id list, refuses with `stale` unless it is exactly the current set, and rewrites positions `0..n-1` in one raw SQL statement so `updated_at` stays put.
- Deleting removes the category and its links; the products stay unchanged.
- No cache tag yet: nothing cached reads categories. Feature 13 adds a `categories` tag with the first storefront read and must expire it from these actions and from the catalog's category writes.

## Tests

`schemas.test.ts` beside the schema; actions and reads against a real database in `tests/db/categories.db.test.ts` (`pnpm test:db`); flows in `tests/e2e/catalog/categories-arrange.spec.ts`.

_Drafted from the introducing change (spec 0009), worth a quick human pass._
