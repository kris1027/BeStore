# 0009. Admin catalog management

**Date**: 2026-10-02
**Status**: In Progress

## Summary

Admins can now run the catalog after a product is created: edit it in separate sections (details, variants and prices, stock, images, categories), hide it (back to draft), archive it, restore it, and delete it when no order ever used it. Stock is set as a plain number but refused if a sale moved it meanwhile, and every stock change (admin edits, opening stock, sales) lands in a new `stock_movements` history table, the only schema change. Products, categories and images reorder by drag and drop that also works by keyboard, products get up to 8 images that can belong to one option value (the red photos of a tee), and the description becomes safe Markdown. Storefront category pages stay in feature 13; here categories are managed in admin only.

## Requirements

**User stories**:
- As an admin, I want to fix and update a product after it is live (text, prices, SKUs, photos, categories) so I never touch the database by hand.
- As an admin, I want to take a product off the storefront without losing it, and retire products I no longer sell, so the store only shows what I can ship.
- As an admin, I want to set stock to what I counted, without undoing a sale that happened while I typed, and see who changed stock and why.
- As an admin, I want to decide the order of products on the home page and the order of categories, using a mouse or the keyboard.
- As a customer, I want to see several photos, the ones for the color I picked, and a clear sale price, so I know what I am buying.

**Acceptance criteria** (the contract):

*Product list and status*
- **AC-1**: `/admin/products` has status tabs All (draft and active), Active, Draft, Archived, Featured; a search box matching product name or any variant SKU (case insensitive, contains, trimmed, up to 100 characters); a category select; 50 rows per page with a "Next page" link (keyset paging, newest first) and a "First page" link once past page one. Featured lists featured draft and active products (not archived). Every filter lives in the URL (`?status=&q=&category=&featured=1&before=`), so a reload or a shared link shows the same rows; "First page" keeps the filters. An unknown `status`, `category` or a malformed `before` falls back to its default, never an error. No match shows an Empty state that names the filters and offers "Clear filters". Each row links to its edit page.
- **AC-2**: The edit page `/admin/products/<id>` shows the product's status with the buttons that apply: draft gets Publish and Archive, active gets Hide and Archive, archived gets Restore (back to draft). Publish is refused with a message when the product has no non archived variant. Hide or archive removes the product from the home grid and its page on the next request (the product page shows the branded 404); Publish shows it again. Restoring never makes a product live by itself.
- **AC-3**: A product that goes active lands first on the home grid: its `position` becomes one below the lowest `position` among active products. Two publishes at the same moment may share a position; the existing newest first tiebreak orders them.
- **AC-4**: A product that is not active and that no order line references (by `product_id` or by any of its variants) shows a Delete button; deleting asks for confirmation naming the product, then removes the product, its variants, options, images, category links, stock history and any cart lines holding its variants, and deletes its image files from Storage. Any order counts, whatever its status (an expired order blocks delete forever, by design). A product an order references never shows Delete; a request to delete it anyway is refused with "This product is on an order. Archive it instead."

*Details section*
- **AC-5**: The Details section edits name, slug, description, featured and weight in grams (optional, 1 to 100000). The slug follows the create rules; changing the slug of an active product shows a warning that old links stop working, and saving expires both the old and the new `product:<slug>` tags.
- **AC-6**: The description is Markdown, up to 5000 characters, with a Write and Preview toggle in the form. The product page renders only paragraphs, line breaks, bold, italic, bulleted and numbered lists, level 2 and 3 headings (a `#` heading renders as level 2, so the product name stays the only `h1`), and links (`http`, `https`, `mailto` only, opening in the same tab, `rel="nofollow"`). Raw HTML and images in the Markdown are never rendered.

*Variants and stock*
- **AC-7**: The Variants section lists every variant with its option values, price, compare at price (optional), SKU and an Archive or Restore button. Price and SKU follow the create rules; a compare at price, when given, must be above the price ("Enter a price above the selling price."). Option type and value names can be renamed (same length and uniqueness rules as create, case insensitive). A save where a new name equals another row's current name (a swap) is refused with "Rename one at a time." Option types cannot be added or removed after create.
- **AC-8**: The admin can add a value to an existing option type (up to 10 values per type; values are never removed, so every value counts). The new value goes last. New variant rows appear only for the new combinations, each needing price, stock (0 allowed) and SKU (SKU suggested as on create); every existing row keeps its values. A product with only a default variant (no option types) cannot add values; the admin creates a new product instead. The total number of variants, archived ones included, never exceeds 100.
- **AC-9**: Archiving the last non archived variant of an active product is refused with "Hide or archive the product instead. A live product needs at least one variant." An archived variant disappears from the storefront picker and flags any cart line holding it (spec 0005, AC-11); restoring it brings it back.
- **AC-10**: The Stock section lists each non archived variant with its current count, a new count field (0 to 999999) and an optional note (up to 200 characters). Save sends, per changed row, the count the page showed; rows whose new count equals the shown count are skipped (a note on them is dropped). All rows save in one transaction. If any row's stock changed since the page loaded, or its variant was archived meanwhile, nothing is saved and every such row shows "Stock is now N. Check it and save again." with N filled in.
- **AC-11**: Every stock change writes one `stock_movements` row in the same transaction as the change: `initial` when a variant is created (create form or a new option value; actor admin, even at stock 0), `adjustment` for a Stock section save (with the admin and the note), and `sale` when the paid webhook or the reconcile cron takes stock (with the order, actor `system`). A sale records what it really took (2 of 3 asked writes `-2`); a sale that took nothing (stock already 0) writes no row. Admin names show even for disabled admins. The Stock section shows the latest 50 movements of the product's variants, newest first: time in `STORE_TIMEZONE`, variant label, kind, change (`+5`, `-2`), count after, who (admin name, or "Order #1042" linking to the order), note.
- **AC-12**: The migration gives every variant that exists before it one `initial` movement with actor `system` and its current stock, so each history starts from a known count.

*Images*
- **AC-13**: The Images section (and the create form) holds up to 8 images. Each needs alt text (1 to 300 characters) and may be tied to one value of one of the product's option types ("Shows: Color / Red"), or to none. Images reorder by drag and drop, or by keyboard (focus the handle, Space to lift, arrows to move, Space to drop, Escape to cancel), with each move announced to screen readers. The first image is the card image. Saving with a 9th image, an image tied to another product's value, a path already used by another image, or an upload that never finished is refused with a field message. Width and height come from the browser and are display hints only.
- **AC-14**: Removing an image deletes its row and, after the save commits, its file from Storage, unless an order line's `image_path` still points at it (the row goes, the file stays, and that order keeps its photo). A failed file delete never fails the save; it is logged.
- **AC-15**: The product page shows a main image and a row of thumbnail buttons (with the image's alt text as their name, the current one marked `aria-current`). The images shown are those tied to a value of the selected variant first, then those tied to no value, each group in `position` order; images tied to other values are hidden. When that leaves nothing (every image is tied to another value), the gallery shows `/placeholder.svg`. Changing the selection updates the gallery. A product with no images shows `/placeholder.svg`. The order line photo (`order_lines.image_path`) is the first image of the same rule, so the order shows the photo the customer saw.

*Sale price*
- **AC-16**: When the selected variant has a compare at price, the product page shows it struck through next to the price, with "Was" in visually hidden text so screen readers read it. A home grid card shows a "Sale" badge when any non archived, in stock variant has a compare at price; a sold out card shows only "Sold out". The cart, checkout, Stripe and orders always use `price_cents` only.

*Categories*
- **AC-17**: The admin nav gets a "Categories" entry. `/admin/categories` lists every category by `position` with its product count (all statuses) and a Hidden badge when not visible, plus "New category". A category has a name (1 to 100), a slug (prefilled from the name, same pattern as products, unique), a description (optional, plain text, up to 2000) and a visible checkbox. A duplicate slug comes back as a field error. An unknown or malformed category id (like an unknown product id on `/admin/products/<id>`) shows the not found state.
- **AC-18**: Products join categories from both sides: a checkbox list of all categories in the product's Categories section (and the create form), and on a category's page a product list with Remove buttons and an "Add products" search (name or SKU, up to 20 results, any status). A product joining a category goes to the end of that category (`product_categories.position` = max + 1).
- **AC-19**: Deleting a category asks for confirmation naming how many products it holds, then removes the category and its links; the products stay unchanged.

*Arranging*
- **AC-20**: `/admin/products/arrange` lists every active product by `position` (thumbnail and name) and `/admin/categories` lists categories, each reorderable by drag and drop or keyboard as in AC-13. Each drop saves at once (the order of products past the 48 the home grid shows is saved too); the home grid shows the new product order on its next request. If the list changed meanwhile (a product published, hidden or deleted, a category added or deleted), the save is refused with "The list changed. Reload to see the latest." and nothing moves.

*Concurrency, safety, quality*
- **AC-21**: Two admins editing one product never overwrite each other silently. Details saves are refused when the product's `updated_at` differs from the one loaded; Variants saves when any edited row's price, compare at price, SKU or archived flag, or any renamed option type or value name, differs from what was loaded; Images saves when the stored images differ from the loaded ones in id set, alt text, position or option link; Categories saves when the stored set of category ids differs from what was loaded. On a category's page, adding a product already linked or removing one already gone does nothing and is not an error. Each refusal says "This product changed since you opened it. Reload to see the latest." and saves nothing.
- **AC-22**: Every new admin page and action calls `requireAdmin()` itself; a non admin gets the proxy's 404 for pages, and actions return nothing useful and change nothing. No action trusts a price, a stock count or an id set from the client beyond comparing it for conflicts.
- **AC-23**: Every catalog change that alters what the storefront shows expires `catalog` and every affected `product:<slug>` with `updateTag` after the transaction commits: details, status, delete, variants, stock, images, arrange. Category changes expire nothing yet (no storefront read uses categories until feature 13).
- **AC-24**: Each action logs one event with the admin id and ids involved, never a description, note text or image alt text: `catalog.product.updated` (with the section), `catalog.product.status_changed` (from, to), `catalog.product.deleted`, `catalog.stock.adjusted` (variant, before, after), `catalog.images.file_delete_failed`, `catalog.products.reordered`, `catalog.category.created`, `catalog.category.updated`, `catalog.category.deleted`, `catalog.categories.reordered`.
- **AC-25**: Every new or changed admin page (list, edit, arrange, categories) and the product page work by keyboard with visible focus and pass axe with no violations, on desktop and phone widths.

## Decision

**Chosen option**: Option 1: extend the existing catalog feature with per section edit actions, compare and set conflict checks, and a stock history table

Editing reuses the create code paths (schemas, variant grid, image upload) and splits into small section actions that each check their own conflict rule, so a stock save never collides with a description edit and nothing is ever overwritten silently.

**Implementation skills**: `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `prisma-cli` (`prisma/skills`, `.agents/skills/prisma-cli/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `accessibility` (`.agents/skills/accessibility/`) · `playwright-best-practices` (`.agents/skills/playwright-best-practices/`) · `next-dev-loop` (`.agents/skills/next-dev-loop/`)

**Calls made in this spec** (pick, why, runner up):
- **Hide is `active → draft`, archive is retirement; no new status.** The enum from spec 0002 already says this; the storefront already filters on `active`. Runner up: a separate visible flag.
- **Option types are fixed after create; values can be added and renamed, variants archived.** `option_key` is built from value ids, so renames and new values never touch existing rows or order snapshots (which store text). Runner up: full regrid, which forces remapping every variant when a type is added.
- **Stock is set by number with compare and set** (`UPDATE ... WHERE id = $1 AND stock_quantity = $expected`), zero rows updated means "moved". Matches a stocktake and never loses a sale. Runner up: plus or minus adjustments.
- **One `stock_movements` table for every change, sales included.** The webhook already locks the row and knows before and after (`takeStock`), so one insert in the same transaction explains every number. Runner up: admin changes only, which leaves sales as unexplained gaps.
- **Conflict checks compare the fields each section edits, not one product version.** The webhook bumps `product_variants.updated_at` on every sale, so a version number would refuse unrelated price edits after each sale. Details uses `products.updated_at` because only Details and status saves change that row; `position` updates use raw SQL so arranging never bumps it. Runner up: a `version` column, needing a migration and still too coarse.
- **The edit page URL uses the product id**, since the slug can change. Runner up: slug URLs that break on rename.
- **The create form gains the same new parts** (compare at price per row, featured, weight, Markdown, up to 8 images with option links, categories) by reusing the section components, and after create it opens the new product's edit page instead of the list. One set of components and rules. Runner up: a minimal create form and everything else on edit, which changes spec 0005 AC-5 for no gain.
- **Image files are deleted after commit, never inside the transaction**, and only when no `order_lines.image_path` references them. Storage and Postgres share no rollback; an order keeps its photo forever. Runner up: leave all files (the sweep the engineer declined for now).
- **Gallery rule lives in one pure function** (`galleryImages`), and `orderLineImage` now returns its first image, so the order snapshot and the product page agree on which photo belongs to a variant (today's snapshot can fall back to another color's photo). Runner up: keep the two rules apart and accept a mismatched order photo.
- **Markdown renders with `react-markdown` in the cached server component**, `allowedElements` limiting it to AC-6, `skipHtml`, `h1` mapped to `h2`, and the default `urlTransform` plus a protocol check. No client JS on the storefront; the admin Preview imports it on the client. Runner up: `marked` plus DOMPurify, which needs `dangerouslySetInnerHTML`.
- **Drag and drop uses `@dnd-kit/core` and `@dnd-kit/sortable`** with `KeyboardSensor`, `sortableKeyboardCoordinates`, and announcements worded with item names. One shared `SortableList` component in `src/components/` serves images, arrange and categories. Runner up: `@dnd-kit/react`, pre 1.0.
- **Arrange saves the full ordered id list** and refuses when it is not exactly the current set of active products (or all categories), then rewrites positions `0..n-1` in one statement. Simple, and AC-3's "one below the lowest" keeps working because publish reads the minimum at that moment. Runner up: fractional positions, which avoid rewriting rows but are harder to reason about at this size.
- **Admin list uses keyset paging on `id`** (UUID v7 is time ordered), like `/admin/orders`, with `ILIKE` contains search and no index. A few hundred products scan in milliseconds. Runner up: offset paging with a total count; `pg_trgm` once the catalog grows into thousands.
- **Delete is offered only for products that are not active** and have no order line, and re checks inside the transaction. One deliberate step (hide first) before an irreversible delete. Runner up: delete straight from active.
- **Stock history shows the latest 50 movements per product**, no paging yet. Enough to answer "what happened this week"; a full history view can come with the sales dashboard.
- **No `categories` cache tag yet.** Nothing cached reads categories; feature 13 adds the tag together with the first read. Runner up: add the tag now and expire it on every category write with nothing listening.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

| Path | What |
|---|---|
| `prisma/migrations/<ts>_stock_movements/` | enum, table, CHECKs, indexes, RLS, backfill |
| `src/features/catalog/schemas.ts` | create schema extended; section schemas: `detailsSchema`, `variantsSchema`, `addOptionValueSchema`, `stockSchema`, `imagesSchema`, `productCategoriesSchema` |
| `src/features/catalog/actions/` | `update-details.ts`, `change-status.ts`, `delete-product.ts`, `update-variants.ts`, `add-option-value.ts`, `adjust-stock.ts`, `update-images.ts`, `update-product-categories.ts`, `reorder-products.ts` |
| `src/features/catalog/admin-queries.ts` | `getAdminProducts(filters)` (paged), `getProductForEdit(id)`, `getStockHistory(productId)`, `getArrangeList()`, `searchProductsForPicker(q)` |
| `src/features/catalog/gallery.ts` | pure: `galleryImages(images, selectedValueIds)` |
| `src/features/catalog/markdown.tsx` | the one Markdown renderer config (allowed elements, link rules) |
| `src/features/catalog/stock.ts` | pure: movement row builders, `formatDelta` |
| `src/features/categories/` | `schemas.ts`, `actions/` (`create-category.ts`, `update-category.ts`, `delete-category.ts`, `reorder-categories.ts`, `set-category-products.ts`), `admin-queries.ts`, `components/`, `log.ts` |
| `src/lib/stock-movements.ts` | `recordMovement(tx, row)`: shared by catalog actions and `src/lib/orders/transitions.ts` (a feature cannot import another's internals) |
| `src/lib/product-image-files.ts` | `deleteUnreferencedImageFiles(paths)`: checks `order_lines.image_path`, then deletes from the bucket, logs failures |
| `src/components/sortable-list.tsx` | the shared dnd-kit sortable list with keyboard support and announcements |
| `app/admin/(panel)/products/[id]/page.tsx`, `products/arrange/page.tsx` | edit and arrange pages |
| `app/admin/(panel)/categories/page.tsx`, `categories/new/page.tsx`, `categories/[id]/page.tsx` | category pages |

Categories get their own feature folder: they have their own pages and actions, and feature 13 will add storefront reads there. The product's Categories section calls `src/features/categories/` only through the catalog action writing `product_categories` itself; neither feature imports the other's internals.

### Data model sketch

New (the only migration):

| Table | Columns | Keys and rules |
|---|---|---|
| `stock_movements` | id uuid v7, variant_id, kind `stock_movement_kind` (`initial`, `adjustment`, `sale`), delta int, stock_after int, actor_type `actor_type`, admin_id?, order_id?, note text?, created_at timestamptz(3) | PK id; variant_id → product_variants Cascade; admin_id → admin_users Restrict; order_id → orders Restrict (orders are never deleted; SetNull would break the sale CHECK) |

CHECKs (raw SQL in the migration): `stock_after >= 0`; `delta <> 0 OR kind = 'initial'`; `(actor_type = 'admin') = (admin_id IS NOT NULL)`; `(kind = 'sale') = (order_id IS NOT NULL)`; `kind <> 'sale' OR actor_type = 'system'`; `kind <> 'adjustment' OR actor_type = 'admin'`; `note IS NULL OR (kind = 'adjustment' AND char_length(note) <= 200)`. Indexes: `(variant_id, created_at)`, `order_id`, `admin_id`. RLS enabled, no policies. Backfill: `INSERT INTO stock_movements (id, variant_id, kind, delta, stock_after, actor_type, created_at) SELECT uuidv7(), id, 'initial', stock_quantity, stock_quantity, 'system', now() FROM product_variants` (use the UUID v7 function the earlier migrations use).

Prisma: model `StockMovement` with `@@map("stock_movements")`, relations on `ProductVariant`, `AdminUser`, `Order`.

Used unchanged (spec 0002): `products` (status, position, featured, weight_grams, description), `product_variants` (compare_at_price_cents, archived, position, option_key), `product_option_types` and `product_option_values` (names, appended values), `product_images` (up to 8, position, option_value_id), `categories` (name, slug, description, visible, position), `product_categories` (position).

Relationships added: variant 1:N stock_movements; order 1:N stock_movements; admin 1:N stock_movements.

### State transitions

Product `status`:

| From | To | Button | Rule |
|---|---|---|---|
| draft | active | Publish | needs at least one non archived variant; sets `position = min(active positions) - 1` (0 when none) |
| active | draft | Hide | none |
| draft, active | archived | Archive | none |
| archived | draft | Restore | none |
| draft, archived | (deleted) | Delete | no order line references the product or its variants |

Variant `archived`: false ⇄ true; refused per AC-9.

### API surface

All are server actions returning `ActionResult<T, E>` (`src/lib/result.ts`); every one calls `requireAdmin()` first and parses its input with Zod. Field errors are dotted paths, as in `createProduct`.

| Action | Inputs | Output | Key errors |
|---|---|---|---|
| `createProduct` (extended) | as today plus `featured`, `weightGrams?`, per variant `compareAtPrice?`, `images[] { path, altText, width, height, optionValue? { typeIndex, value } }` (0 to 8), `categoryIds[]` | `{ productId, slug }`, then the edit page | as today plus `compare_at`, `too_many_images`, `unknown_category` |
| `updateProductDetails` | `productId`, `loadedUpdatedAt`, `name`, `slug`, `description`, `featured`, `weightGrams?` | `{ slug }` | `validation`, `slug_taken`, `stale`, `not_found` |
| `changeProductStatus` | `productId`, `to` (`active`, `draft`, `archived`) | `{ status }` | `invalid_transition`, `no_variants`, `not_found` |
| `deleteProduct` | `productId` | `{}`, then the list | `on_order`, `is_active`, `not_found` |
| `updateVariants` | `productId`, `rows[] { variantId, loaded { price, compareAt, sku, archived }, price, compareAt?, sku, archived }`, `optionNames[] { typeId, loadedName, name, values[] { valueId, loadedValue, value } }` | `{}` | `validation`, `sku_taken`, `last_variant`, `rename_swap`, `stale` |
| `addOptionValue` | `productId`, `optionTypeId`, `value`, `newVariants[] { otherValueIds[], price, compareAt?, stock, sku }` | `{ variantIds[] }` | `validation`, `too_many_values`, `too_many_variants`, `sku_taken`, `stale` (the combinations sent are not exactly the missing ones) |
| `adjustStock` | `productId`, `rows[] { variantId, expected, next, note? }` | `{}` | `validation`, `moved { variantId, now }[]` (every row that missed; `now` is the current count, or the row is flagged archived) |
| `updateProductImages` | `productId`, `loaded[] { id, altText, position, optionValueId }`, `images[] { id? or path, altText, width, height, optionValueId? }` in order | `{}` | `validation`, `too_many_images`, `image_missing`, `image_duplicate`, `foreign_option_value`, `stale` |
| `updateProductCategories` | `productId`, `loadedCategoryIds[]`, `categoryIds[]` | `{}` | `unknown_category`, `stale` |
| `reorderProducts` | `orderedIds[]` | `{}` | `stale` |
| `createCategory` / `updateCategory` | (`categoryId`, `loadedUpdatedAt` for update), `name`, `slug`, `description?`, `visible` | `{ categoryId }` | `validation`, `slug_taken`, `stale` |
| `deleteCategory` | `categoryId` | `{}` | `not_found` |
| `reorderCategories` | `orderedIds[]` | `{}` | `stale` |
| `setCategoryProducts` | `categoryId`, `add[]`, `remove[]` (product ids); adding an existing link or removing a missing one is a no op | `{}` | `unknown_product`, `not_found` |
| `createImageUpload` (existing) | unchanged | signed upload URL | unchanged |

Reads (admin, never cached): `getAdminProducts({ status, q, categoryId, featured, before })`, `getProductForEdit(id)`, `getStockHistory(productId)`, `getArrangeList()`, `getAdminCategories()`, `getCategoryForEdit(id)`, `searchProductsForPicker(q)`.

Storefront reads (cached, changed): `getActiveProducts` adds `onSale`; `getProductBySlug` returns all images (each with `optionValueId`), `descriptionMarkdown`, and `compareAtPriceCents` per variant.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Admin list | rows, total stock, price range | `products` with non archived variants, `summarizeVariants` (as today) |
| Admin list | search match | `products.name ILIKE %q%` OR any `product_variants.sku ILIKE %q%` (q trimmed, `%` and `_` escaped) |
| Admin list | next page cursor | fetch 51 rows; when there are 51, `id` of the 50th is the next `before` (`id < before`, ordered `id desc`); a `before` that is not a UUID is ignored |
| Admin list | category options | `categories` by `position` |
| Publish | new `position` | `min(position) - 1` over `status = 'active'`, read in the same transaction (0 when none) |
| Delete | "on an order" | `EXISTS order_lines WHERE product_id = $id OR variant_id IN (the product's variants)`, any order status, checked in the transaction after `SELECT ... FOR UPDATE` on the product row |
| Delete | files to delete | the product's `product_images.storage_path`, read before the delete |
| Details save | conflict | `products.updated_at` sent from the loaded page vs the row |
| Details save | tags to expire | old slug (read in the transaction) and new slug |
| Variants save | conflict | each row's `loaded` values vs the row |
| Variants save | "last variant" | count of non archived variants after the change, when status is `active` |
| Add option value | missing combinations | `combinations()` from `variant-grid.ts` over current values plus the new one, minus existing `option_key`s |
| Add option value | new value `position` | `max(position) + 1` within its option type |
| Add option value | new variant `position`, `option_key` | `max(position) + 1` onward, in grid order; `optionKey()` of the sorted value ids |
| Add option value | `initial` movement | the new variant's stock, actor admin |
| Stock save | conflict | `expected` (the count the page showed) vs `stock_quantity`, compared in the `UPDATE ... WHERE` |
| Stock save | movement `delta`, `stock_after` | `next - expected`, `next`; rows with `next = expected` are skipped before the transaction; any guarded `UPDATE` that matches 0 rows (count moved, or variant archived) rolls back the whole save |
| Webhook and reconcile sale | movement `delta`, `stock_after` | `takeStock` changes to return `{ before, after }` and takes the order id; `delta = after - before`, `stock_after = after`; no row when equal |
| Stock history | who | `admin_users.name` for admin rows (disabled admins included); `orders.number` for sale rows; "System" for backfilled rows |
| Stock history | variant label | `variantLabel()` from `src/lib/variant-label.ts`, "Default" for a default variant |
| Stock history | time | `created_at` shown in `STORE_TIMEZONE` (`src/lib/dates.ts`) |
| Images save | `position` | index in the submitted list |
| Images save | upload exists | Storage `exists(path)` for new paths, before the transaction (as create); a path already in `product_images` returns `image_duplicate` |
| Images save | option link valid | `optionValueId` belongs to an option type of this product |
| Images save | files to delete | removed rows' `storage_path` not referenced by any `order_lines.image_path` |
| Product page | gallery | `galleryImages(images, selectedVariant.optionValueIds)`: tied to a selected value, then untied, each by `position`; empty means the placeholder |
| Checkout start | `order_lines.image_path` | `galleryImages(images, variantValueIds)[0]?.storagePath ?? null` (replaces the fallback in `orderLineImage`) |
| Product page | "Was" price | selected variant's `compare_at_price_cents` |
| Home card | `onSale` | any non archived variant with `stock_quantity > 0` and `compare_at_price_cents` not null |
| Arrange | current set | `products WHERE status = 'active'` (or all `categories`), compared to `orderedIds` as sets |
| Category picker add | link `position` | `max(position) + 1` in that category (0 when empty) |
| Category delete | product count shown | `count(product_categories)` for the category |
| Every action | admin id | `requireAdmin()` |

### Key invariants

- Every change to `product_variants.stock_quantity` writes exactly one `stock_movements` row in the same transaction (except a sale that took nothing), and `stock_after` equals the new `stock_quantity`.
- An active product always has at least one non archived variant.
- Option types never change after create; `option_key` of an existing variant never changes.
- A Storage file referenced by any `order_lines.image_path` is never deleted.
- A product referenced by any order line is never hard deleted by the app.
- At most 8 `product_images` per product (checked in the action; the count runs inside the transaction).
- Catalog tags are expired only after the commit.
- `startCheckout` takes `FOR KEY SHARE` on the variants it snapshots, so a concurrent `deleteProduct` (which holds `FOR UPDATE` on the product and deletes its variants) waits or sees the new order line; a product is never deleted under a pending order.
- Hiding, archiving, repricing or deleting never touches an existing pending order: it is charged its snapshot price and takes stock when paid (spec 0006).
- `markdown.tsx` is shared by the cached server render and the client Preview, so it carries no `server-only` import.
- Prices, stock and id sets from the client are compared, never trusted (AC-22).

### Security model

One role (admin, spec 0004). Every page above sits under the proxy admin gate and also calls `requireAdmin()`; every action calls it first. No customer facing write is added. The Markdown renderer never outputs raw HTML and allows only safe link protocols, so a description cannot inject script into the storefront. Image uploads keep spec 0005's signed URL flow (admin only, fixed path shape, bucket limits). No personal data is involved; stock notes are admin text and stay out of logs. The new table has RLS enabled with no policies (reached only through Prisma on the server).

### Observability

The pino events in AC-24 via `src/features/catalog/log.ts` and `src/features/categories/log.ts`. Every event carries `adminId`; none carries free text.

### Configuration required

No new environment variables. New dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `react-markdown`.

### Critical test scenarios

- Status: publish, hide, archive, restore; storefront grid and page follow on the next request; publish with no variants refused; published product lands first, verifies **AC-2**, **AC-3**, **AC-23**
- Delete: never ordered draft deletes with its files; a product with an order line (pending or paid) is refused even by a direct action call, verifies **AC-4**, **AC-14**
- Stock race (db test): load, then a sale takes 1, then the admin saves; refused with "Stock is now N"; nothing written. Two concurrent admin saves with the same expected value: exactly one wins, verifies **AC-10**
- History (db test): create writes `initial`, admin save writes `adjustment` with note, webhook writes `sale` with order id, a sale at stock 0 writes nothing; CHECKs reject a sale without order and an adjustment without admin, verifies **AC-11**, **AC-12**
- Variants: rename a value, add a value (only missing rows appear, SKUs unique), refuse past 10 values or 100 variants, archive last variant of an active product refused, compare at at or below price refused, verifies **AC-7**, **AC-8**, **AC-9**
- Conflicts: two sessions edit Details, Variants, Images, Categories; second save refused each time; a sale in between does not refuse a price edit, verifies **AC-21**
- Images: 8 accepted, 9th refused, foreign option value refused, reorder by keyboard only, removed file deleted unless an order line uses it, gallery switches with the color, verifies **AC-13**, **AC-14**, **AC-15**
- Markdown: `<script>`, raw HTML, `javascript:` links and images do not render; `#` renders as `h2`, verifies **AC-6**
- Sale: struck price with hidden "Was"; card badge only when an in stock variant has one; cart and Stripe charge the real price, verifies **AC-16**
- Categories: create, duplicate slug, assign from both sides, delete with products keeps the products, reorder by keyboard, verifies **AC-17**, **AC-18**, **AC-19**, **AC-20**
- Arrange: reorder by keyboard, home grid follows; a stale list is refused, verifies **AC-20**
- List: each filter, search by SKU, paging, URL reload keeps filters, empty state, verifies **AC-1**
- Auth: a signed out user and a non admin get 404 on every new page and a refused action, verifies **AC-22**
- Accessibility: axe and keyboard on every touched page, desktop and phone, verifies **AC-25**

## Build plan

Tracer Bullet: milestone 1 pushes one real edit through every layer (admin page, action, DB, cache tag, storefront) before any segment is thickened.

**Milestone 1, thin thread: edit and hide**
1. `getProductForEdit`, `/admin/products/<id>` with the Details section (name, slug, description as plain text for now, featured, weight), `updateProductDetails` with the `updated_at` conflict check and both slug tags, list rows link to it, satisfies **AC-5**, **AC-21**, **AC-22**, **AC-23**
2. `changeProductStatus` with the transition table, publish position rule and status buttons; status tabs on the list; e2e: hide a product, it leaves the home grid and its page; publish it, it is first, satisfies **AC-2**, **AC-3**, **AC-23**
3. `catalog.product.updated` and `catalog.product.status_changed` logs; create now opens the edit page, satisfies **AC-24**

**Milestone 2, variants, stock and history**
4. Migration `stock_movements` (enum, table, CHECKs, indexes, RLS, backfill) and the Prisma model; `src/lib/stock-movements.ts`; db tests for every CHECK and the backfill, satisfies **AC-11**, **AC-12**
5. `createProduct` writes `initial` movements; `takeStock` in `src/lib/orders/transitions.ts` returns `{ before, after }`, takes the order id and writes the `sale` movement (covers the webhook and the reconcile cron); update `tests/db/` webhook tests, satisfies **AC-11**
6. Stock section and `adjustStock` (compare and set, per row errors, note), history table via `getStockHistory`; db race tests, satisfies **AC-10**, **AC-11**, **AC-24**
7. Variants section and `updateVariants` (price, compare at, SKU, archive and restore, renames, last variant rule, loaded values conflict check); `addOptionValue` reusing `variant-grid.ts`; compare at in the create grid, satisfies **AC-7**, **AC-8**, **AC-9**, **AC-21**
8. Storefront sale price: `compareAtPriceCents` on the product page and `onSale` badge on cards, satisfies **AC-16**

**Milestone 3, images and Markdown**
9. Install dnd-kit; `src/components/sortable-list.tsx` with keyboard sensor and named announcements; unit and e2e keyboard tests, satisfies **AC-13**, **AC-25**
10. Images section (shared with create): up to 8, alt text, option value link, reorder; `updateProductImages` with the id set conflict check; `src/lib/product-image-files.ts` deleting unreferenced files after commit (also used by `deleteProduct` later), satisfies **AC-13**, **AC-14**, **AC-21**
11. `gallery.ts` with unit tests; product page gallery with thumbnail buttons; `getProductBySlug` returns all images; `orderLineImage` uses the same rule (update `order-image.test.ts`), satisfies **AC-15**
12. Install `react-markdown`; `markdown.tsx`; Write and Preview in Details and create; product page renders it; tests for every refused construct, satisfies **AC-6**

**Milestone 4, categories, arranging, list and delete**
13. `src/features/categories/`: list, new, edit pages; create, update, delete actions; nav entry; logs, satisfies **AC-17**, **AC-19**, **AC-24**
14. Product Categories section and create checkboxes (`updateProductCategories`); category page product list with Remove and "Add products" picker (`setCategoryProducts`, `searchProductsForPicker`), satisfies **AC-18**, **AC-21**
15. `/admin/products/arrange` and category reordering with `SortableList`; `reorderProducts` and `reorderCategories` with the set check and raw SQL position rewrite, satisfies **AC-20**, **AC-23**, **AC-24**
16. Admin list: search, category select, featured tab, keyset paging, URL state, empty state, satisfies **AC-1**
17. `deleteProduct` with the product row lock and in transaction order check, `FOR KEY SHARE` on variants in `startCheckout`, confirm dialog, file cleanup, `catalog.product.deleted`; db race test (delete versus checkout start), satisfies **AC-4**, **AC-14**, **AC-24**

**Milestone 5, safety net**
18. DB tests in `tests/db/catalog-*.db.test.ts` for every conflict rule, delete guard, arrange set check and category actions; Playwright in `tests/e2e/catalog/` and `tests/e2e/admin/` for each flow in *Critical test scenarios*, axe and keyboard on every touched page at desktop and phone widths, satisfies **AC-1** to **AC-25**

## Migration plan

**Strategy**: one additive migration (new enum and table, then backfill in the same migration).
**Phases**:
1. Migration adds `stock_movement_kind`, `stock_movements` with CHECKs, indexes and RLS, then inserts one `initial` row per existing variant.
2. The same deploy ships the code that writes movements (create, adjust, webhook).
**Rollback**: revert the code; the table can stay (nothing else reads it) or be dropped by a follow up migration. Nothing existing is altered.
**Risks**: a sale between the backfill and the new webhook code going live writes no `sale` row; the history then shows a gap until the next change. Acceptable before launch (no production traffic yet).

## Consequences

**Positive**:
- Admins can fix every mistake from the UI; spec 0005's "fix it in the database" gap closes.
- Every stock number is explained by its history, which feature 10 (refund restock) and feature 15 (dashboard) can build on.
- No admin overwrites another's work or a sale silently.
- Order snapshots (name, SKU, price, photo) stay intact through every edit.

**Negative / tradeoffs**:
- Option types cannot be added to an existing product; the admin creates a new product instead.
- Abandoned uploads (a form opened, photo chosen, never saved) stay in the bucket; only removed images are cleaned.
- A sale refuses an admin's open stock save on that variant, by design; the admin re enters the number.
- Existing plain text descriptions now render as Markdown: single line breaks join into one paragraph until an admin adds a blank line.
- Two new client dependencies in admin (dnd-kit) and one in the storefront render path (`react-markdown`, server only on the storefront).
- `ILIKE` search scans the table; fine for hundreds of products, needs `pg_trgm` at thousands.
- Slug changes break old links until feature 17 adds redirects.
- A file can be deleted while a checkout that already read the image row is still committing, leaving that one order without its photo. The window is milliseconds; accepted and logged rather than adding a delay or sweep.

**Neutral**:
- `src/features/categories/` is a new feature folder that feature 13 will extend.
- The webhook transaction gains one insert per line that took stock.

## Follow-up

- [ ] Feature 13: add a `categories` cache tag with the first storefront category read, and expire it from every category action and from `updateProductCategories` and `setCategoryProducts`; decide whether category product order (`product_categories.position`) gets a drag and drop view.
- [ ] Feature 10: add a `restock` (or `refund_restock`) value to `stock_movement_kind` when refunds return stock, and write it in the refund transaction.
- [ ] Feature 17: render `meta_title` and `meta_description` (no editor yet), and redirect old product slugs if broken links matter.
- [ ] Deferred: sweep abandoned uploads in `product-images` (files no `product_images` row and no order line references, older than a day), if storage cost grows.
- [ ] `/sync` after the build: add `src/features/categories/AGENTS.md` and the new conventions (section actions, conflict rules, stock movements) to `src/features/catalog/AGENTS.md`.
