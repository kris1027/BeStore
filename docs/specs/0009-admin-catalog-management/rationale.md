# 0009. Admin catalog management: rationale

Decision record for [index.md](index.md).

## Context

Spec 0005 built only the create path: an admin can add a product with variants, one image and a status, but cannot change anything afterwards. Its consequences say it plainly: a mistake is fixed by feature 9 or by hand in the database. The scope (feature 9) asks to edit, hide, reorder and delete products, manage categories, hold several images per product and change stock per variant.

Forces at play:
- **The schema is already there.** Spec 0002 created `product_status` (`draft`, `active`, `archived`), `position` columns, `compare_at_price_cents`, `featured`, `weight_grams`, `product_images.option_value_id`, `categories` and `product_categories`. The rule from spec 0002 is that products on any order are archived, never deleted.
- **Stock has two writers.** The Stripe webhook takes stock inside a locked transaction (`takeStock`, spec 0006) at any moment, and admins will now set stock by hand. A naive save undoes a sale.
- **Orders are snapshots.** Order lines store name, variant label, SKU, unit price and `image_path` text, so edits must never reach back into them, and a file an order shows must survive.
- **Cache Components.** Storefront reads are `'use cache'` with `catalog` and `product:<slug>` tags; every change must expire the right tags after commit, including the old slug on a rename.
- **A few trusted admins**, one role, working at the same time now and then. Accessibility is WCAG AA, so any reorder UI must work by keyboard and screen reader.
- **Storefront category pages belong to feature 13.** Here categories are an admin concern only.

If this is not decided, the store cannot correct a price, restock, retire a product or show more than one photo, and every later feature (refunds that restock, the dashboard, SEO, category pages) has no admin data to build on.

## Options considered

### Option 1: Extend the catalog feature with per section actions, compare and set checks, and a stock history table

The edit page splits into sections, each with its own small server action and its own conflict rule (version for details, loaded values for variants, expected count for stock, id sets for images and categories). A new `stock_movements` table records every stock change, sales included.

**Pros**:
- Each action is small, testable and touches only its rows; a stock save never blocks a description edit.
- Conflict checks match each section's real writers, so the webhook's `updated_at` bump does not refuse unrelated edits.
- Stock history explains every number and gives feature 10 a place to record restocks.

**Cons**:
- More actions and more conflict rules to test than one form.
- One migration and an extra insert in the webhook transaction.

### Option 2: One edit form mirroring create, one save, optimistic lock on `products.updated_at`

Reuse the create form wholesale for edit; one action diffs everything; a single version check guards it.

**Pros**:
- One form, one action, closest to existing code.
- Familiar for admins who used create.

**Cons**:
- A sale between load and save either refuses the whole form or, without a stock check, silently restores sold stock.
- A large diffing action (variants, images, categories, stock at once) is the hardest code to get right and to test.
- No history of who changed stock.

### Option 3: Option 1 without a history table (logs only)

Same sections and checks, but stock changes go only to pino logs.

**Pros**:
- No migration.

**Cons**:
- Sales and edits cannot be shown to the admin next to the stock; answering "where did 4 units go" needs log access.
- Feature 10 restocks would have nowhere structured to land.

## Rationale

Option 1 follows from the two writers of stock: only a compare and set on the count, plus a record of each change, keeps the number both correct and explainable. The engineer chose the history table over logs for that explanation, and chose to include sales so gaps never appear; the webhook already holds the row lock and knows before and after, so the cost is one insert.

Section saves follow from the same force: the webhook touches variants constantly, so one product wide version would turn every sale into a refused edit. Splitting by section lets each check use the exact fields it writes. Keeping option types fixed after create protects `option_key` and spares a remapping problem that has no good UI, while adding and renaming values covers the real need (a new size, a typo).

The libraries are the boring choices for the stack: `@dnd-kit/core` with `sortable` is mature, headless (fits shadcn on Base UI) and ships keyboard reordering and announcements, which WCAG AA requires; `react-markdown` renders to React elements without `innerHTML` and runs in the cached server component, so the storefront ships no extra client JS and has no sanitizer to misconfigure.

## Tool discovery

Community skills found during the design (not installed at spec time; the engineer decides): `cfardev/kanban-hub@dnd-kit` (a small community dnd-kit guide) and `mikkelkrogsholm/dev-skills@react-markdown` (a community react-markdown guide). An MCP docs bridge for the dnd-kit repository exists through GitMCP. None is official.
