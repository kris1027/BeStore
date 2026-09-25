# 0002. Data model: rationale

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

BeStore is a single brand store selling in one country, one currency and one language (spec 0001). Every planned slice (buy loop, payment, shipping, catalog admin, order admin, emails, accounts, discovery, discounts, dashboard) reads or writes the same core data. The scope's done condition for this feature is strict: the schema must support all of those slices, including variants, guest and account orders, refunds and promo codes, with no breaking migration later, and order lines must keep the price paid when the product changes.

The forces:
- **Money and stock correctness.** Payments are real. A negative stock count, a total that does not match its lines, or a Stripe event applied twice cost real money and trust. Spec 0001 already fixes integer cents, UTC timestamps, conditional stock updates and an idempotent webhook.
- **One builder, AI assisted.** Rules only in application code get forgotten by the next slice. Rules in the database cannot be forgotten.
- **Guests first, accounts later.** Most buyers are guests; feature 12 must later attach a guest's past orders to a new account by email.
- **EU privacy.** Names, emails, phones and addresses are personal data under GDPR, while orders must be kept for accounting.
- **Access path.** Prisma on the server is the only way in; Supabase's Data API must expose nothing (RLS on, no policies).

Without this decision, each slice would invent its own tables and conventions, and the first slice to touch orders would lock in choices (status model, snapshot shape, discount accounting) that refunds and the dashboard then fight against.

## Options considered

### Option 1: Normalized schema, snapshots, DB enforced invariants, full target migration now

Relational tables for every entity (generic option types, many to many categories, typed order snapshot columns, separate refund, event, redemption and once only tables), CHECK constraints and unique indexes for the rules that must never break, all applied in one migration during this feature.

**Pros**:
- Every later slice starts with its tables in place; the done condition is testable now.
- Correctness rules hold regardless of which action writes the row.
- Snapshots make order history immune to catalog edits.

**Cons**:
- Tables exist before their features, so a design mistake is found later rather than sooner.
- Raw SQL alongside `schema.prisma` means two places to read the full rules.

### Option 2: Same model, migrated slice by slice

This spec as the target, but each slice creates only its own tables when it is built.

**Pros**:
- Pure Tracer Bullet: no table exists before code uses it.
- Each slice can refine its tables with real usage in hand.

**Cons**:
- Feature 3 cannot be done until slice 8 ships.
- More migrations to coordinate, and early slices may quietly drift from the target.

### Option 3: Leaner, denormalized model

Fixed `size`/`color` columns on variants, JSON for variant attributes and order addresses, a single category per product, a status that includes `refunded`, counters instead of redemption rows.

**Pros**:
- Fewer tables and joins; faster to write the first slices.

**Cons**:
- Breaks scope requirements: a third option, partial refunds, per customer code limits, and a product in several categories all need breaking migrations.
- JSON columns lose DB constraints and are harder to search in order admin.

## Rationale

Option 1 is the only one that meets the scope's "no breaking migration" condition while keeping feature 3 closable now. Its main risk, designing tables before their features exist, is contained because every downstream slice's shape was walked through here (variants, refunds, redemptions, once only emails), and a later correction is an additive migration plus a spec update. Option 2 buys little extra safety, since the target is already fixed by this spec, and leaves the foundation open for months. Option 3 is faster for slice 1 but fails the scope on at least four known requirements.

Choices inside Option 1, in brief:
- **Generic option types** over fixed columns: any option without a migration, and feature 13 filters on option values. Runner up: fixed `size`/`color` columns.
- **Always a variant**: one code path for price, stock, cart and order lines. Runner up: price on product for simple items (two code paths).
- **Pending order at checkout start** over creating it in the webhook: what Stripe charges is exactly what was saved, and the Stripe session id gives the idempotency key. Cost: expired pending rows, handled by the `expired` status.
- **One status plus `refunded_cents`** over split payment and fulfilment statuses: one state machine for admins; partial refunds remain visible. Runner up: two status columns.
- **Typed snapshot columns** over JSONB for addresses: searchable in order admin, DB enforced shape. Runner up: JSONB validated by Zod.
- **Customer rows only for accounts**: guests leave no profile, which means less personal data; the order's email carries guest history. Runner up: a customer row for every buyer.
- **No stock hold at checkout**: no stuck stock from abandoned checkouts; the rare race is caught by the conditional decrement and flagged with `needs_attention`. Runner up: `reserved_quantity` holds.
- **Redemption held at checkout, released on expiry**: the last use of a code cannot be oversold. Runner up: count only when paid.
- **UUID v7** ids: safe in URLs, time ordered for index locality, same type as auth ids. Runner up: UUID v4.
- **Postgres enums** over text plus CHECK: type safety in TypeScript; adding a value is additive. Runner up: text with CHECK.
- **Lowercased text emails** over `citext`: no extension, plain Prisma filters. Runner up: `citext`.
- **Admins disabled, never deleted**: history keeps a real link to the actor. Runner up: delete and store a name snapshot.
- **Nullable tax columns and an order currency now**: cheap, and they make the deferred tax and currency features additive.
- **Separate `test:db` suite with a Postgres service in CI**: real constraint tests on every PR without Supabase's heavier stack; the schema uses no Supabase specific SQL. Runner up: `supabase start` in CI.

Decisions made in writing (not asked):
- **`option_key`** stored on the variant makes "one variant per combination" a plain unique index. Runner up: a trigger checking combinations (more SQL, harder to test).
- **`dedupe_key`** on `email_sends` instead of a composite unique: refund emails can repeat per refund, and nullable composite uniques do not dedupe in Postgres. Runner up: `(order_id, kind, refund_id)` with `NULLS NOT DISTINCT`.
- **`@db.Timestamptz(3)` everywhere**, because Prisma's default `timestamp` has no time zone and would break the UTC invariant.
- **Order numbers from 1001**: avoids "order #1" on launch day. Runner up: start at 1.
- **Cart lifetime of 30 days**, pushed forward on each write. Runner up: 14 days.
- **Email collected on BeStore's own checkout form** (settled here after the cross check): the redemption, per customer limits and guest linking all need it before payment. Runner up: let Stripe collect it (then limits could only be checked after payment).
- **Row lock on the promo code** for the last use race. Runner up: a `redemption_count` column with a conditional increment (a stored derived value to keep in step).
- **`email_sends` inserted as `pending` before sending**, with the dedupe key as Resend's idempotency key: no lost email and no double send on retry. Runner up: insert after a successful send (duplicates on a crash between send and insert).
- **A separate test database** so tests never wipe dev data. Runner up: a separate Postgres schema in the dev database (Prisma would need a second schema config).
- **Truncate between db tests, run serially**: simple and exact isolation. Runner up: wrapping each test in a rolled back transaction (does not work for concurrency tests).
