# Verify: Admin catalog management · spec 0009 · updated 2026-10-03
_Steps derived from spec 0009 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] `/admin/products`: tabs All, Active, Draft, Archived, Featured; All shows no archived product; Featured shows featured draft and active ones → AC-1
- [x] Search a variant SKU in lower case → the product shows; reload keeps `?q=`; search `100%` matches only names containing "100%" → AC-1
- [x] Pick a category, then a tab → the URL keeps both; `?category=nope&status=bogus&before=x` shows the default list, no error → AC-1
- [x] With more than 50 products: "Next page" then "First page", filters kept → AC-1
- [x] A search with no match → Empty state naming the filters, "Clear filters" returns to `/admin/products` → AC-1
- [x] Draft product: Publish and Archive show; active: Hide and Archive; archived: Restore → AC-2
- [x] Publish a draft whose variants are all archived → refused with a message → AC-2
- [x] Hide a live product → home grid and `/products/<slug>` (branded 404) drop it on the next request; Publish → it is the first card → AC-2, AC-3, AC-23
- [x] Restore an archived product → it becomes a draft, never live → AC-2
- [x] Draft never ordered → Delete asks naming the product, then it is gone with its cart lines and image files; a product on any order (pending or expired) shows no Delete → AC-4, AC-14
- [x] Change the slug of a live product → warning about old links; after save the old URL 404s and the new one renders → AC-5
- [x] Description: `# Care`, `**bold**`, a list, `<script>`, `[x](javascript:alert(1))`, an image → Preview and product page show h2 "Care", bold, the list; no script, no link for javascript:, no image → AC-6
- [x] Variants: compare at equal to the price → "Enter a price above the selling price."; swap two value names → "Rename one at a time." → AC-7
- [x] Add a value to Color → only the new combinations appear, SKUs suggested, existing rows unchanged; the 11th value or a 101st variant is refused → AC-8
- [x] Archive the last variant of a live product → "Hide or archive the product instead. A live product needs at least one variant." → AC-9
- [x] Stock: load, change the count in the database, save → "Stock is now N. Check it and save again."; save again → saved → AC-10
- [x] History shows the adjustment with the admin's name and note, a sale as "Order #N" linking to the order, the opening count as System, times in Europe/Warsaw → AC-11
- [x] Every variant created before the migration has one `initial` movement at its stock → AC-12
- [x] Images: upload 8, the 9th is refused; reorder by keyboard (Space, arrows, Space) with each move announced; tie one to "Color / Red" → AC-13
- [x] Remove an image an order line shows → the row goes, the file stays; remove another → its file is gone → AC-14
- [x] Product page: picking Red shows the red photos then the untied ones, thumbnails named by alt text with `aria-current`; all photos tied to another value → placeholder → AC-15
- [x] Order of a Blue variant keeps a blue or untied photo, never the red one → AC-15
- [x] Compare at price → product page shows the struck price read as "Was"; card shows "Sale"; a sold out card shows only "Sold out"; Stripe charges the price → AC-16
- [x] `/admin/categories`: New category, duplicate slug → field error; Hidden badge; product count of all statuses; unknown id → not found state → AC-17
- [x] Add a product from the category page search and another from the product's checkboxes → both listed, newest at the end → AC-18
- [x] Delete a category with 2 products → the dialog says 2, the products remain → AC-19
- [x] `/admin/products/arrange` and `/admin/categories`: reorder by keyboard, saved at once; hide a product in another tab first → "The list changed. Reload to see the latest." → AC-20
- [x] Two tabs edit Details, Variants, Images and Categories of one product; the second save of each is refused with "This product changed since you opened it. Reload to see the latest." → AC-21
- [x] A signed in non admin gets 404 on every new page; a disabled admin's save changes nothing → AC-22
- [x] Logs carry ids only: no description, note or alt text in `catalog.*` events → AC-24
- [x] axe and keyboard on list, edit, arrange, categories and the product page at desktop and phone widths → AC-25

## Value sourcing
- [x] Publish position: with active positions 3 and 5, a publish lands at 2; with none, at 0 → AC-3
- [x] Next page cursor: the 50th row's id; a non UUID `before` is ignored → AC-1
- [x] Details conflict uses `products.updated_at`; a sale (variant row only) never refuses a price or Details save; arranging never bumps it → AC-21
- [x] Add option value: new value position is last in its type; new variants take positions after every existing one; `option_key` is the sorted value ids → AC-8
- [x] Sale movement: 2 of 3 asked gives `-2`; nothing taken gives no row → AC-11
- [x] Category link position: max + 1 in that category, 0 when empty → AC-18
- [x] `order_lines.image_path` equals the first gallery image for the variant → AC-15

## Commands
- [x] `pnpm test` → all unit tests pass → AC-6, AC-10, AC-13, AC-15, AC-16, AC-20
- [x] `pnpm test:db` → all db suites pass, including `catalog-*`, `categories`, `stock-movements` → AC-1 to AC-24
- [ ] `pnpm test:e2e tests/e2e/catalog tests/e2e/admin` → all pass → AC-1 to AC-25

## Acceptance-criteria coverage
- AC-1 list steps · AC-2 to AC-4 status and delete · AC-5, AC-6 Details · AC-7 to AC-12 variants and stock · AC-13 to AC-15 images · AC-16 sale · AC-17 to AC-19 categories · AC-20 arrange · AC-21 conflicts · AC-22 auth · AC-23 cache steps under AC-2 · AC-24 logs · AC-25 accessibility
