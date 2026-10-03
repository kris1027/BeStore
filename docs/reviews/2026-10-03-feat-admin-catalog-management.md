# Review, feat/admin-catalog-management, 2026-10-03

**Reviewed by**: Claude Sonnet 5.5 (author on the same family; fresh context)
**Scope**: 124 files (pnpm-lock.yaml excluded from the stat count), branch vs main (merge base 44eba11)
**Verdict**: Approve with nits

## Summary
Adds the full admin catalog editor (details, variants, stock with compare and set, images, categories, status, delete, arrange), a `stock_movements` history table written in the same transaction as every stock change (including the paid order transition), a categories feature, and a product delete that is made safe against in flight checkouts by a lock handshake. The work is careful: every action and page calls `requireAdmin()`, every storefront affecting write expires `catalogTag` and the right `productTag` (both slugs on rename), checkout still charges `priceCents` (compare at price is display only), and concurrency is reasoned through and covered by db tests. No blockers or majors found; the issues below are low probability races and polish.

## Minor
### 🟡 Product row `FOR UPDATE` in updateVariants can deadlock with an in flight checkout, `src/features/catalog/actions/update-variants.ts:82`
**Problem**: `save` locks the product with `FOR UPDATE` (full lock), then updates variants, and a changed `sku` is a unique indexed (key) column so that UPDATE needs a `FOR UPDATE` row lock on the variant. `startCheckout` (`start-checkout.ts:228-235`) holds `FOR KEY SHARE` on the same variants and then inserts order lines whose FK needs `KEY SHARE` on the product row, which conflicts with the full `FOR UPDATE`. Cycle: admin holds product waits variant, checkout holds variant waits product.
**Why it matters**: Postgres aborts one side after the deadlock timeout (40P01): either the admin save or a customer checkout fails with a 500. Needs a SKU edit on a variant being checked out at that moment, so rare, but delete-product.ts already documents and avoids this exact hazard by using `FOR NO KEY UPDATE`.
**Suggested fix**: Use `FOR NO KEY UPDATE` on the product row in updateVariants (and consider the other product-locking actions: status, add value, images, categories) so it cannot conflict with a FK key share; keep `FOR UPDATE` only where the slug/key columns on products change (details).

### 🟡 Variants updated in client row order, other paths lock in id order, `src/features/catalog/actions/update-variants.ts:140`
**Problem**: `adjustStock` and `markPaid` lock variants sorted by id (stock.ts documents "never deadlock"), but updateVariants updates `edited` rows in whatever order the form sent them.
**Why it matters**: A multi-row price edit racing a multi-row stock save or a paid order with several lines can deadlock; same failure mode as above.
**Suggested fix**: Sort `edited` by variantId before the update loop.

### 🟡 Category deleted between check and link surfaces as an uncaught FK error, `src/features/catalog/actions/create-product.ts:41` and `src/features/catalog/actions/update-product-categories.ts:43`
**Problem**: createProduct counts categories before the transaction; updateProductCategories counts inside it but without locking the category rows. A `deleteCategory` committing in between makes `linkAtEnd` hit a 23503 foreign key violation, which is thrown (500) rather than returned as `unknown_category` / a field error.
**Why it matters**: Expected failure should be a value per project rules; low frequency, admin only, no data harm.
**Suggested fix**: Lock the category rows (linkAtEnd already does, so do the existence check after that lock inside the transaction) or map 23503 to the existing error.

### 🟡 Image width and height are client supplied and unchecked, `src/features/catalog/schemas.ts:48`
**Problem**: Dimensions come from the browser (bounded 1 to 10000) and are stored as is; the server only checks the object exists.
**Why it matters**: Wrong values only skew layout (admin only input), but they are trusted for `next/image` sizing on the storefront.
**Suggested fix**: Accept as is, or read the dimensions from the stored object when verifying the upload. Low priority.

## Nits
- ⚪ `src/features/catalog/actions/adjust-stock.ts:94`, `setStock` guard can never mismatch under the row lock; fine as documented defence, just dead in practice.
- ⚪ `src/components/arrange-list.tsx:50`, if the server action itself throws (network), the optimistic order is not restored; only a refused result is handled.
- ⚪ `prisma/migrations/20261003052525_stock_movements/migration.sql:~60`, backfilled UUID v7 ids all share one millisecond prefix (`clock_timestamp()` per row is fine but ordering within history relies on `created_at`, which is also one `now()`); harmless since each variant has one row.
- ⚪ `src/lib/product-image-files.ts:11`, the file delete after commit can in theory race a checkout that just snapshotted that `image_path`; the window is tiny and the failure is a missing thumbnail on one order.

## Strengths
- Delete product lock handshake (product `FOR NO KEY UPDATE`, variants `FOR UPDATE`, checkout `FOR KEY SHARE`) with a db test that proves the wait, plus the on_order check covering both product_id and variant_id and any order status.
- Compare and set stock under row locks in id order with movements written in the same transaction, `sale` rows recording what was really taken, and CHECK constraints so a wrong history row cannot be stored; RLS enabled on the new table.
- Cache invalidation is complete and deliberate (both slugs on rename, hide/archive/delete/stock/price/image all expire catalog + product tags; categories and category links correctly skip it per AC-23); markdown renderer whitelists elements and protocols and skips raw HTML.
- Section level optimistic concurrency (updated_at token for details, field level compare for variants/images/categories) and raw SQL position rewrites that deliberately do not bump the conflict token.

## Test coverage
Strong. Vitest unit tests cover the pure rules (stock, status, variant-edit, sortable, like, gallery, markdown, image-edit, schemas); the db project covers each action including races (two stock saves from one count, delete waiting on a checkout, sale moving a row, archived meanwhile, stale refusals, movements per kind); Playwright covers edit, variants/stock, images/markdown, categories/arrange, denials and a11y. A checkout test pins price vs compare at price. Not covered: the updateVariants versus checkout lock cycle and an update-variants versus adjust-stock ordering race (the two minors above), and the category-deleted-mid-save path.
