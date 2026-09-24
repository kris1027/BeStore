# 0002. Data model for BeStore

**Date**: 2026-09-24
**Status**: Proposed

## Summary

This spec fixes the whole database schema for BeStore in one go: catalog (products, variants with their own price and stock, categories, images), people (admins, customers, address books), carts, orders with frozen snapshots of what was bought, refunds, promo codes, and a few operational tables. It ships as one Prisma migration now, so every later slice builds on tables that already exist and never needs a breaking change. Money is whole cents, times are UTC, ids are time ordered UUIDs, and the database itself enforces the rules that must never break (stock never negative, totals add up, each Stripe event handled once).

## Requirements

**User stories**:
- As the builder of each later slice, I want every table I need to already exist with the right constraints, so I only write actions and UI.
- As an admin, I want past orders to show exactly what was bought and paid, even after I rename, reprice, or archive a product.
- As the store owner, I want the database itself to refuse impossible states (negative stock, totals that do not add up, a Stripe event applied twice), so a code bug cannot corrupt money or stock.

**Acceptance criteria**:
- **AC-1**: On an empty database, `pnpm db:migrate` applies one migration that creates every table and enum in `## Feature design`; afterwards `prisma migrate dev` reports no drift, and `pnpm typecheck` passes against the generated client.
- **AC-2**: Every table in the `public` schema (including `_prisma_migrations`) has RLS enabled and no policies.
- **AC-3**: An order line keeps its product name, variant label, SKU, image path and unit price after the product is renamed, the variant is repriced, or the variant is archived; if the product is hard deleted, the line survives with `variant_id` and `product_id` set to null.
- **AC-4**: `stock_quantity` can never go below 0: a direct update to a negative value fails with a CHECK violation, and a conditional decrement (`WHERE stock_quantity >= n`) for more than is in stock updates 0 rows.
- **AC-5**: Two variants of the same product with the same option combination are rejected; a duplicate SKU, product slug, category slug, or promo code is rejected; a promo code that is not uppercase is rejected.
- **AC-6**: All money is stored as integer cents, and the database rejects an order whose `total_cents` differs from `subtotal_cents - discount_cents + shipping_cents`, whose discount exceeds its subtotal, whose `refunded_cents` exceeds its total, whose `total_cents` is 0, or with any negative amount; an order line whose `line_total_cents` differs from `unit_price_cents * quantity - discount_cents` is rejected.
- **AC-7**: An order can be stored with no customer (guest), but never without an email. Deleting a customer deletes their addresses and cart and sets `customer_id` to null on their orders, which stay intact.
- **AC-8**: Once only records hold: a second `stripe_events` row with the same event id, a second `email_sends` row with the same dedupe key, a second redemption for the same order, and a second `pending_payment` order for the same cart are each rejected by a unique constraint.
- **AC-9**: After migrating, `store_settings` holds exactly one row (id 1, flat shipping 0, no free shipping threshold), and inserting a second row fails.
- **AC-10**: A customer has at most one default address and at most one cart; a cart has at most one line per variant, and its quantity is above 0.
- **AC-11**: An admin referenced by an order event or refund cannot be deleted (only disabled via `disabled_at`); an order event or refund with `actor_type = admin` must name an admin, and any other actor must not.
- **AC-12**: Order numbers are unique, assigned by the database, and start at 1001.
- **AC-13**: `pnpm db:seed` fills a local database with a demo catalog (categories, a simple product with one default variant, products with one and two option types), is safe to run twice, and refuses to run against a non local database unless `--yes` is passed.
- **AC-14**: `pnpm test:db` runs the constraint tests against a dedicated test database named by `TEST_DATABASE_URL` (locally a `bestore_test` database on the Supabase stack's Postgres, in CI a Postgres service container) and never touches the dev database; `pnpm test` still runs without a database.
- **AC-15**: With the redemption pattern this spec defines (lock the `discount_codes` row `FOR UPDATE`, count its redemptions, insert), two concurrent transactions racing for the last use of a code end with exactly one redemption.

## Decision

**Chosen option**: Option 1: Normalized relational schema with snapshots and DB enforced invariants, shipped as one full target migration

Model the full store in Prisma as normalized tables (generic option types for variants, many to many categories, typed order snapshots, separate refund, event and redemption tables), enforce money, stock and uniqueness rules with Postgres constraints added as raw SQL in the same migration, and apply it all now.

**Implementation skills**: `prisma-database-setup`, `prisma-cli`, `prisma-client-api` (`prisma/skills`, `.agents/skills/`) · `supabase-postgres-best-practices`, `supabase` (`supabase/agent-skills`, `.agents/skills/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Conventions (every table)

- **Ids**: `String @id @default(uuid(7)) @db.Uuid` (UUID v7, time ordered). Exceptions: `admin_users.id` and `customers.id` are the Supabase auth user uuid (no default, no FK into `auth`, per spec 0001); `stripe_events.id` is the Stripe event id (`text`); `store_settings.id` is `Int` fixed to 1.
- **Names**: Prisma models PascalCase, fields camelCase; tables plural snake_case via `@@map`, columns snake_case via `@map`. Enums map to snake_case Postgres types with lowercase snake values.
- **Time**: every `DateTime` is `@db.Timestamptz(3)` (Prisma's default is `timestamp` without time zone, which breaks the UTC invariant). `created_at @default(now())`, `updated_at @default(now()) @updatedAt` on mutable tables (`@updatedAt` and `uuid(7)` are filled by Prisma Client, not the DB, so the DB default keeps raw SQL inserts working; raw inserts, in the migration or tests, must supply their own ids, since Postgres 17 has no `uuidv7()`).
- **Money**: `Int` cents, suffix `_cents`, CHECK `>= 0` unless stated. Percentages and tax rates are integers too (`tax_rate_bps` = basis points, 2300 = 23%).
- **Emails** are trimmed and lowercased by Zod before any write; plain `text`. Promo codes are uppercased by Zod, and a CHECK enforces it.
- **Text**: `text` columns; length limits live in Zod schemas, not the DB.
- **FK columns** always get an index (Postgres does not add one).
- **RLS**: the migration runs `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` for every table it creates, plus `_prisma_migrations` guarded by `DO $$ BEGIN IF to_regclass('public._prisma_migrations') IS NOT NULL THEN ... END IF; END $$;` (the shadow database may not have it). No policies. Prisma connects as the table owner, so it is unaffected.
- **Partial index**: enable `previewFeatures = ["partialIndexes"]` in the generator and declare the default address rule in Prisma (`@@unique([customerId], where: raw("is_default"))`), so it never shows up as drift.
- **Raw SQL** in the migration covers what Prisma cannot express: CHECK constraints, RLS, the order number start, and the settings row. Create the migration with `prisma migrate dev --create-only`, append the SQL, then apply.

### Enums

| Enum (Postgres type) | Values |
|---|---|
| `ProductStatus` (`product_status`) | `draft`, `active`, `archived` |
| `OrderStatus` (`order_status`) | `pending_payment`, `paid`, `shipped`, `delivered`, `cancelled`, `expired` |
| `OrderEventType` (`order_event_type`) | `created`, `status_changed`, `refund_created`, `refund_succeeded`, `refund_failed`, `stock_shortfall`, `note` |
| `ActorType` (`actor_type`) | `admin`, `system`, `customer` |
| `RefundStatus` (`refund_status`) | `pending`, `succeeded`, `failed` |
| `DiscountType` (`discount_type`) | `percent`, `fixed_amount` |
| `EmailKind` (`email_kind`) | `order_confirmation`, `order_shipped`, `order_refunded` |
| `EmailSendStatus` (`email_send_status`) | `pending`, `sent`, `failed` |

### Data model sketch

`?` = nullable. `→` = FK with its `onDelete` rule.

**Catalog**

| Table | Columns | Constraints and indexes |
|---|---|---|
| `products` | id, name, slug, description (Markdown) default `''`, status `ProductStatus` default `draft`, featured bool default false, position int default 0, weight_grams int?, meta_title?, meta_description?, created_at, updated_at | slug unique; CHECK weight_grams > 0; index (status, position) |
| `product_option_types` | id, product_id → products Cascade, name ("Size"), position int | unique (product_id, name); index product_id |
| `product_option_values` | id, option_type_id → product_option_types Cascade, value ("M"), position int | unique (option_type_id, value) |
| `product_variants` | id, product_id → products Cascade, sku, price_cents, compare_at_price_cents?, stock_quantity int default 0, archived bool default false, position int, option_key text, created_at, updated_at | sku unique; unique (product_id, option_key); CHECK price_cents >= 0, stock_quantity >= 0, compare_at_price_cents > price_cents |
| `variant_option_values` | variant_id → product_variants Cascade, option_value_id → product_option_values NoAction | PK (variant_id, option_value_id); index option_value_id |
| `categories` | id, name, slug, description?, visible bool default true, position int, meta_title?, meta_description?, created_at, updated_at | slug unique; index (visible, position) |
| `product_categories` | product_id → products Cascade, category_id → categories Cascade, position int | PK (product_id, category_id); index (category_id, position) |
| `product_images` | id, product_id → products Cascade, storage_path, alt_text default `''`, position int, width int?, height int?, option_value_id? → product_option_values SetNull, created_at | storage_path unique; index (product_id, position); index option_value_id |

`option_key` = the variant's option value ids sorted ascending and joined with `,`; the empty string for a product's default variant (no options). It makes "one variant per combination" a plain unique index. Keeping it in step with `variant_option_values` is the catalog action's job (same transaction).

**People and cart**

| Table | Columns | Constraints and indexes |
|---|---|---|
| `admin_users` | id (auth uuid), email, name, disabled_at?, created_at, updated_at | email unique |
| `customers` | id (auth uuid), email, name?, phone?, created_at, updated_at | email unique |
| `customer_addresses` | id, customer_id → customers Cascade, full_name, line1, line2?, city, postal_code, country_code char(2), phone?, is_default bool default false, created_at, updated_at | partial unique index (customer_id) WHERE is_default; index customer_id |
| `carts` | id, customer_id? → customers Cascade, expires_at, created_at, updated_at | customer_id unique (nulls allowed, so any number of guest carts); index expires_at |
| `cart_items` | id, cart_id → carts Cascade, variant_id → product_variants Cascade, quantity int, created_at, updated_at | unique (cart_id, variant_id); CHECK quantity > 0; index variant_id |

**Orders and money**

| Table | Columns | Constraints and indexes |
|---|---|---|
| `orders` | id, number int (sequence), status `OrderStatus` default `pending_payment`, needs_attention bool default false, customer_id? → customers SetNull, cart_id? → carts SetNull, email, customer_name?, phone?, ship_full_name?, ship_line1?, ship_line2?, ship_city?, ship_postal_code?, ship_country_code char(2)?, currency char(3), subtotal_cents, discount_cents default 0, shipping_cents default 0, tax_cents?, total_cents, refunded_cents default 0, discount_code_id? → discount_codes SetNull, discount_code?, discount_type `DiscountType`?, discount_value int?, stripe_checkout_session_id?, stripe_payment_intent_id?, tracking_number?, carrier?, paid_at?, shipped_at?, delivered_at?, cancelled_at?, expired_at?, created_at, updated_at | number unique, `@default(autoincrement())`; stripe_checkout_session_id unique; stripe_payment_intent_id unique; CHECK total_cents = subtotal_cents - discount_cents + shipping_cents; CHECK discount_cents <= subtotal_cents; CHECK refunded_cents <= total_cents; CHECK total_cents > 0; partial unique (cart_id) WHERE status = 'pending_payment' (declared in Prisma); indexes (status, created_at), paid_at, email, customer_id, cart_id |
| `order_lines` | id, order_id → orders Cascade, variant_id? → product_variants SetNull, product_id? → products SetNull, product_name, variant_label?, sku, image_path?, unit_price_cents, quantity int, discount_cents default 0, line_total_cents, tax_cents?, tax_rate_bps int?, created_at | CHECK quantity > 0; CHECK line_total_cents = unit_price_cents * quantity - discount_cents; CHECK discount_cents <= unit_price_cents * quantity; indexes order_id, variant_id, product_id |
| `order_events` | id, order_id → orders Cascade, type `OrderEventType`, from_status `OrderStatus`?, to_status `OrderStatus`?, actor_type `ActorType`, admin_id? → admin_users Restrict, message?, created_at | CHECK (actor_type = 'admin') = (admin_id IS NOT NULL); index (order_id, created_at); index admin_id |
| `refunds` | id, order_id → orders Cascade, amount_cents, reason?, status `RefundStatus` default `pending`, stripe_refund_id?, actor_type `ActorType`, admin_id? → admin_users Restrict, succeeded_at?, created_at, updated_at | CHECK amount_cents > 0; CHECK (actor_type = 'admin') = (admin_id IS NOT NULL); CHECK (status = 'succeeded') = (succeeded_at IS NOT NULL); stripe_refund_id unique; indexes order_id, succeeded_at, admin_id |
| `refund_lines` | id, refund_id → refunds Cascade, order_line_id → order_lines Cascade, quantity int, restocked bool default false | CHECK quantity > 0; unique (refund_id, order_line_id); index order_line_id |
| `discount_codes` | id, code, type `DiscountType`, value int, starts_at?, ends_at?, max_redemptions int?, per_customer_limit int?, min_subtotal_cents int?, active bool default true, created_at, updated_at | code unique; CHECK code = upper(code); CHECK (type = 'percent' AND value BETWEEN 1 AND 100) OR (type = 'fixed_amount' AND value > 0); CHECK ends_at > starts_at; CHECK max_redemptions > 0, per_customer_limit > 0 |
| `discount_redemptions` | id, discount_code_id → discount_codes Restrict, order_id → orders Cascade, email, created_at | order_id unique; index (discount_code_id, email) |

**Operations**

| Table | Columns | Constraints |
|---|---|---|
| `store_settings` | id int default 1, flat_shipping_cents default 0, free_shipping_threshold_cents int?, updated_at | PK id; CHECK id = 1; row inserted by the migration |
| `stripe_events` | id text (Stripe event id), type, processed_at default now() | PK id |
| `email_sends` | id, order_id → orders Cascade, kind `EmailKind`, dedupe_key, status `EmailSendStatus` default `pending`, resend_id?, sent_at?, created_at, updated_at | dedupe_key unique; index order_id; index status |

`dedupe_key` format: `order_confirmation:<orderId>`, `order_shipped:<orderId>`, `order_refunded:<refundId>` (a partial refund can send more than one refund email). Send order (feature 11): insert the row as `pending` first (a conflict means another run owns it), call Resend with `dedupe_key` as its idempotency key, then mark `sent` or `failed`; a retry picks up `pending`/`failed` rows and reuses the same key, so Resend never delivers twice.

**Relationships at a glance**: product 1:N option types 1:N option values; product 1:N variants N:M option values; product N:M categories; product 1:N images (N:1 option value, optional); customer 1:N addresses, 1:1 cart (optional), 1:N orders; cart 1:N items N:1 variant; order 1:N lines, events, refunds, email sends; order 1:1 redemption (optional) N:1 discount code; refund 1:N refund lines N:1 order line; admin 1:N events, refunds.

### State transitions

**Order** (`status`):

```
pending_payment ──webhook: paid──────────▶ paid ──admin──▶ shipped ──admin──▶ delivered
       │                                      │
       ├──session expired / cron──▶ expired   └──admin──▶ cancelled
       └──admin cancels unpaid──▶ cancelled
```

- Stock is decremented only on `pending_payment → paid`, in the same transaction as the status change and the `stripe_events` insert. If a decrement updates 0 rows, the order still becomes `paid`, `needs_attention` is set, and a `stock_shortfall` event is written (the admin refunds in feature 10).
- Leaving `pending_payment` for `expired` or `cancelled` deletes the order's `discount_redemptions` row, which frees that code use.
- Redemption pattern (checkout start, feature 14): in the transaction that creates the pending order, `SELECT ... FROM discount_codes WHERE id = ? FOR UPDATE`, then count its redemptions (total, and by this email), refuse when a limit is reached, then insert the redemption. The row lock serializes racing checkouts on the same code.
- One pending order per cart: starting checkout again for a cart that already has a `pending_payment` order expires that order (and its Stripe session) first, in the same transaction; the partial unique index makes a duplicate impossible.
- `delivered`, `cancelled` and `expired` are terminal. Refunds are not a status: `refunded_cents` shows none, partial, or full.
- Each transition writes one `order_events` row. Feature 10 decides whether `paid → cancelled` requires a refund first and whether it restocks.

**Refund** (`status`): `pending → succeeded | failed`. Marking it `succeeded` sets `succeeded_at` and adds its amount to the order's `refunded_cents` in the same transaction. Refunds made in the Stripe dashboard arrive through the webhook with `actor_type = system` and no admin.

**Derived views** (no extra status values):
- Fully refunded: `refunded_cents = total_cents`. Partially refunded: `0 < refunded_cents < total_cents`. The admin "refunded" filter (feature 10) uses these.
- Revenue for a period (feature 15): sum of `total_cents` for orders with `paid_at` in the period, minus sum of `amount_cents` for refunds with `succeeded_at` in the period, both bounded in `STORE_TIMEZONE`.

### API surface

This feature adds no server actions or routes; each slice owns its own. Its surface is the schema, the generated client, the seed, and the test suite.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `db` (`src/lib/db.ts`, exists) | Prisma client, server only | Prisma queries | typed rows | server code only (`server-only`) | P2002 unique violation, P2003 FK violation, CHECK violation (through `@prisma/adapter-pg`, match on the Postgres codes 23505, 23503, 23514 carried in the error, not on a guessed Prisma code; callers map these to `{ ok: false }` results) |
| `pnpm db:migrate` | CLI | `DIRECT_URL` | applied migration | local developer | drift reported |
| `pnpm db:seed` (`prisma db seed`, runs `tsx prisma/seed.ts`) | CLI | `DIRECT_URL`; `pnpm db:seed -- --yes` to allow a remote host | demo catalog | local developer | refuses when the `DIRECT_URL` host is not `localhost`/`127.0.0.1` and `--yes` is absent |
| `pnpm test:db` | CLI | `TEST_DATABASE_URL` pointing at a migrated test DB | Vitest report | local and CI | fails fast if `TEST_DATABASE_URL` is unset or equals `DATABASE_URL`/`DIRECT_URL` |

### Value sourcing

Values this schema must be able to hold, and where later slices fill them from.

| Action | Value | Source |
|---|---|---|
| Checkout start (feature 7) | `orders.number` | DB sequence (`autoincrement`), started at 1001 by the migration |
| Checkout start | `orders.currency` | `STORE_CURRENCY` env (spec 0001) |
| Checkout start | `order_lines.product_name`, `sku`, `unit_price_cents` | live `products.name`, `product_variants.sku`, `product_variants.price_cents` at that moment |
| Checkout start | `order_lines.variant_label` | the variant's option values ordered by `product_option_types.position`, joined with ` / `; null for a default variant |
| Checkout start | `order_lines.image_path` | first `product_images` row by position whose `option_value_id` is one of the variant's values, else the product's first image, else null |
| Checkout start | `subtotal_cents` | sum of `unit_price_cents * quantity` |
| Checkout start | `shipping_cents` | `store_settings` (feature 8 rule; 0 until then) |
| Checkout start | `discount_*`, `order_lines.discount_cents` | the applied `discount_codes` row; per line split is feature 14's pricing rule |
| Checkout start | `email` | BeStore's own checkout form, required before the order is created (decided here, so the redemption email and per customer limits work before payment) |
| Checkout start | `orders.cart_id` | the cart id from the signed cart cookie |
| Webhook (feature 7) | `paid_at`, `stripe_payment_intent_id` | Stripe event payload; `stripe_events.id` = event id |
| Refund (feature 10) | `refunded_cents`, `succeeded_at` | sum of `succeeded` `refunds.amount_cents`; `succeeded_at` from the Stripe refund event time, else `now()` |
| Refund | `actor_type`, `admin_id` | the acting admin from `requireAdmin()`, or `system` for a webhook refund |
| Mark shipped (feature 10) | `tracking_number`, `carrier` | admin form input |
| Email send (feature 11) | `email_sends.status`, `resend_id` | the Resend API response |
| Any write | `created_at`, `updated_at` | DB `now()` / Prisma `@updatedAt`, UTC |
| Cart write (feature 6) | `carts.expires_at` | now + 30 days, pushed forward on every cart write |
| Seed | demo rows | constants in `prisma/seed.ts` |
| `pnpm test:db` | connection | `TEST_DATABASE_URL` (local: `postgresql://postgres:postgres@127.0.0.1:55322/bestore_test`; CI: the service container) |

### Key invariants

- Price, stock and SKU live only on variants; every product has at least one variant (a product with no options has exactly one, with `option_key = ''`). Enforced by the catalog actions.
- A variant has exactly one option value per option type of its product. Enforced by the catalog actions; `option_key` makes duplicates impossible in the DB.
- Order lines are snapshots: nothing about a paid order is ever read from live catalog rows.
- Products or variants that appear on any order are archived, never hard deleted (catalog actions check this; the SetNull FKs are a safety net).
- `sum(order_lines.line_total_cents) = orders.subtotal_cents - orders.discount_cents` (the pricing module guarantees it; tested in feature 7).
- `sum(refund_lines.quantity)` for a line never exceeds that line's `quantity` (refund action; feature 10).
- The paid total is never 0 (CHECK), because Stripe Checkout cannot take a zero payment and only the webhook may mark an order paid.
- Tax is included in prices: `tax_cents` is the tax contained in `total_cents`, never added to it.
- Orders and admin users are never deleted by the app.
- `stock_quantity >= 0` (CHECK) and every decrement is a conditional update inside a transaction.
- Raising a price to or above `compare_at_price_cents` fails the CHECK; the catalog action (feature 9) clears or validates the compare at price in the same update.

### Security model

- The browser never reaches these tables. RLS is on with no policies, so Supabase's Data API (anon and authenticated keys) returns nothing. Prisma runs server only as the table owner.
- Admin authority is a live `admin_users` row with `disabled_at IS NULL`; feature 5 builds `requireAdmin()` on top.
- Customer ownership: a customer reads only rows with their `customer_id` (orders, addresses, cart). Enforced in queries by the feature that serves them (feature 12).
- PII (names, emails, phones, addresses) lives in `customers`, `customer_addresses` and `orders`. GDPR applies (EU store). Account deletion removes the profile, addresses and cart; orders keep their snapshot for accounting, unlinked from the customer.
- Audit: every order status change and refund is recorded in `order_events` with its actor; admins are disabled, never deleted, so the actor link never breaks.
- No secrets are stored in the database.

### Configuration required

- `TEST_DATABASE_URL`: the database `pnpm test:db` migrates and truncates; never the dev or any deployed database. Optional in the `src/lib/env.ts` schema (the app never reads it), listed in `.env.example`. Locally, create it once with `createdb` against the Supabase stack's Postgres and run `prisma migrate deploy` against it (the `test:db` script does the deploy).

### Critical test scenarios

All in `*.db.test.ts`, run by `pnpm test:db`.
- Happy path: seed runs twice without error or duplicates; a product with two option types, four variants, a cart, a pending order with lines, a paid transition with a stock decrement, and a partial refund all insert and read back, verifies **AC-1**, **AC-12**, **AC-13**
- Snapshot: rename the product, reprice and archive the variant, then hard delete the product in raw SQL (bypassing the app rule); the line still reads the original values with null links, verifies **AC-3**
- Stock race: two concurrent conditional decrements for the last unit; exactly one updates a row, stock ends at 0, verifies **AC-4**
- Constraints: each CHECK and unique rule in the sketch is violated once and rejected, verifies **AC-5**, **AC-6**, **AC-8**, **AC-9**, **AC-10**, **AC-11**
- Guests and deletion: an order with no customer saves, one with no email fails; deleting a customer keeps their orders, verifies **AC-7**
- Promo race: two concurrent transactions follow the redemption pattern for a code with one use left; exactly one redemption exists afterwards, verifies **AC-15**
- Access: a query over `pg_class` and `pg_policies` shows RLS on for every `public` table and zero policies, verifies **AC-2**

## Build plan

Tracer Bullet within a foundation: prove the thread (schema → migration → generated client → a real DB test in CI) on a thin slice of tables first, then widen the same thread to the full model. Everything ships in one migration before the feature is marked done; the first milestone iterates on an uncommitted migration.

**Milestone 1: thin thread through every layer**
1. Add `products`, `product_variants` and `store_settings` to `prisma/schema.prisma` with the conventions above; `prisma migrate dev --create-only`; append RLS, the stock and price CHECKs, and the settings row; apply, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-9**
2. Add the db test setup: split `vitest.config.ts` into Vitest `projects`, `unit` (today's config, excluding `**/*.db.test.ts`) and `db` (`**/*.db.test.ts`, `fileParallelism: false`); `pnpm test` runs `unit`, `pnpm test:db` runs `prisma migrate deploy` against `TEST_DATABASE_URL` then the `db` project; a helper builds its own `PrismaClient` from `TEST_DATABASE_URL` (not `src/lib/db.ts`, which needs the full env) and refuses if it equals `DATABASE_URL` or `DIRECT_URL`; `beforeEach` runs `TRUNCATE ... RESTART IDENTITY CASCADE` on every table except `_prisma_migrations` and `store_settings`; add `TEST_DATABASE_URL` to `src/lib/env.ts` (optional) and `.env.example`, satisfies **AC-14**
3. Add a Postgres 17 service container to `.github/workflows/ci.yml` with `DIRECT_URL` and `TEST_DATABASE_URL` both pointing at it, then `pnpm test:db`; first tests: RLS check and the stock CHECK, satisfies **AC-2**, **AC-4**, **AC-14**

**Milestone 2: full catalog, people and cart**
4. Reset the uncommitted migration and add option types, option values, `variant_option_values`, categories, `product_categories`, images, `admin_users`, `customers`, `customer_addresses`, `carts`, `cart_items`, with their indexes, CHECKs, the default address partial unique index and RLS, satisfies **AC-1**, **AC-2**, **AC-5**, **AC-10**
5. Tests for variant combination and slug/SKU uniqueness, default address, cart line rules, customer deletion cascade, satisfies **AC-5**, **AC-7**, **AC-10**

**Milestone 3: orders, money and operations**
6. Add `orders`, `order_lines`, `order_events`, `refunds`, `refund_lines`, `discount_codes`, `discount_redemptions`, `stripe_events`, `email_sends` with all enums, CHECKs, indexes, RLS, and `ALTER SEQUENCE orders_number_seq START WITH 1001 RESTART WITH 1001` so order numbers start at 1001 (setting START keeps `TRUNCATE ... RESTART IDENTITY` in tests at 1001), satisfies **AC-1**, **AC-2**, **AC-6**, **AC-8**, **AC-11**, **AC-12**
7. Tests for totals and line CHECKs, the required email, snapshot survival, the stock race, once only uniques (including one pending order per cart), admin restrict and actor CHECKs, order numbering, the promo race, satisfies **AC-3**, **AC-4**, **AC-6**, **AC-7**, **AC-8**, **AC-11**, **AC-12**, **AC-15**
8. Confirm `prisma migrate dev` reports no drift (CHECKs are invisible to drift; the partial index is declared in Prisma) and run the Supabase security advisor on the local stack, satisfies **AC-1**, **AC-2**

**Milestone 4: seed**
9. Add `tsx` as a dev dependency; write `prisma/seed.ts` and register it as `migrations.seed: "tsx prisma/seed.ts"` in `prisma.config.ts`, script `db:seed` = `prisma db seed`: upserts by slug and SKU, two categories, one simple product, one with Size, one with Size and Color; no images (the storefront shows its empty image state); refuses a `DIRECT_URL` host other than `localhost`/`127.0.0.1` unless `--yes`, satisfies **AC-13**
10. Test that the seed runs twice cleanly and that the host guard refuses, satisfies **AC-13**

## Consequences

**Positive**:
- Later slices write actions and UI only; no slice needs a breaking migration.
- Money, stock, and once only rules hold even when application code has a bug.
- Order history is stable forever, independent of catalog edits.
- The first real DB test suite and CI database arrive now, ready for every later feature.

**Negative / tradeoffs**:
- 23 tables exist before most features use them; a slice that finds a column wrong still needs an additive migration and a spec update.
- Rules split between DB CHECKs and application code (variant completeness, line sums, refund quantities); the spec lists which is which, and both need tests.
- `option_key` and `refunded_cents` are stored derived values that the owning actions must keep in step, in the same transaction.
- Raw SQL in the migration is invisible to `schema.prisma`; anyone reading only the Prisma schema misses the CHECKs.
- CI gets slower by the time a Postgres container takes to start and migrate.

**Neutral**:
- Order numbers have gaps (expired pending orders consume numbers).
- Seeded products have no images until feature 9 exists.

## Follow-up

- [ ] Feature 5 builds `requireAdmin()` on `admin_users` (live row, `disabled_at IS NULL`) and how the first admin row is created.
- [ ] Feature 7 collects the email on BeStore's checkout form (decided here), and decides the Stripe session lifetime and the cron fallback that expires stale pending orders.
- [ ] Feature 14 keeps every discounted total at or above Stripe's minimum charge for `STORE_CURRENCY` (the DB only guarantees above 0), and uses the redemption pattern in `### State transitions`.
- [ ] Feature 10 decides whether cancelling a paid order requires a refund and whether it restocks.
- [ ] Feature 14 defines how the order discount is split across lines (rounding).
- [ ] Feature 12 links guest orders to a new account by verified email (`UPDATE orders SET customer_id WHERE email = ? AND customer_id IS NULL`), and keeps `customers.email` in step when the email changes in Supabase Auth.
- [ ] Feature 5 and 12: one auth user may hold both an `admin_users` and a `customers` row; confirm that is intended.
- [ ] Feature 13 adds a search index on `products.name` (`pg_trgm` or full text) and normalizes option value casing ("Red" vs "red") so filters match across products; both additive.
- [ ] Feature 17 decides whether changed slugs need a redirect record (an additive `slug_redirects` table).
- [ ] Feature 11 adds the retry for `failed` and stale `pending` email sends.
- [ ] Feature 6 adds the cron that deletes carts past `expires_at`.
- [ ] `/sync` records the conventions in root `AGENTS.md` (`@db.Timestamptz`, `@@map` snake_case, UUID v7 ids, raw SQL CHECKs in migrations, `pnpm test:db`).
