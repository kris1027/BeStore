# 0013. Categories, search and filters: rationale

## Context

Shoppers can only browse one capped grid of 48 products on the home page. Categories exist (flat, ordered, with a visible flag and SEO fields), but only admins see them; the storefront header nav is empty and waiting for them. There is no search and no way to narrow by price, size or colour.

Forces that shape the design:
- **Small catalog.** Under 500 active products expected in the next year or two. A few admins write; many shoppers read.
- **Option types are per product with free text names.** "Size" on one tee and "size" on another are separate rows, so any cross product filter must match by name and value text, not by id. Spec 0002 flagged the casing problem.
- **Cache Components is on.** Catalog reads are `'use cache'` functions tagged `catalog`; every product write and every stock change (the webhook, refunds) already expires that tag. Request data like `searchParams` must sit behind Suspense.
- **One language, configurable.** `STORE_LOCALE` may be Polish or English, so search must handle accented and special letters (ł does not decompose under Unicode normalization).
- **Functional style rules.** Pure logic stays free of I/O; DB at the edges.
- **Spec 0005 rule:** stock counts above the low stock threshold never reach the browser.

Without this feature the store cannot grow past a few dozen products without customers losing them.

## Options considered

### Option 1: One cached index, filtered in pure code

Load every listable product with its sellable variants, option values and category links in one cached read tagged `catalog` and `categories`. Each request parses the URL and runs pure functions for search, filters, facet counts, sort and paging.

**Pros**:
- No database round trip per search or filter change; one query rebuilds the index after a write.
- Every rule is a pure function, trivially unit tested, matching the project's functional style.
- Facet counts (several "what if" counts per request) are cheap loops instead of many SQL aggregates.
- No migration, no new infrastructure; accent folding is one small function.

**Cons**:
- Memory and CPU grow with the catalog; past a couple of thousand products the cache entry and the per request scan become a problem.
- Any write rebuilds the whole index.

### Option 2: SQL per request

Build the filter, sort and paging query with `$queryRaw`, plus a facet count query per option group, with `unaccent` and `pg_trgm` indexes on names.

**Pros**:
- Scales to tens of thousands of products.
- Typo tolerant search is one operator away (`pg_trgm` similarity).

**Cons**:
- Every search and filter change hits the database (the Supabase pooler), and disjunctive facet counts need one query per group or a complex grouping query.
- A migration for extensions and indexes; raw SQL composition is harder to test than pure functions.
- Per request results either skip the cache or create one cache entry per URL.

### Option 3: Hosted search engine

Meilisearch, Typesense or Algolia (as of my knowledge; this space moves fast), synced from every catalog write.

**Pros**:
- Typo tolerance, ranking and facets built in.

**Cons**:
- A new service to run or pay for, credentials, and a sync path that must stay consistent with stock and status changes (including the webhook).
- Far more than a few hundred products need.

## Rationale

The catalog is small and read heavy, and every write already expires a cache tag, so the cheapest correct design is to cache the whole sellable catalog once and compute listings in memory. That keeps the database out of the shopper's path, keeps the logic pure (the project's rule), and makes the hardest part, per variant matching with disjunctive facet counts, a set of plain loops with unit tests instead of a tangle of SQL. SQL per request is the right answer only at a scale nobody has asked for; the Follow-up names the threshold and keeps `buildListing` as the oracle if that move ever happens. A hosted engine adds a service and a sync path to solve typo tolerance, which was explicitly not wanted.

Per variant matching was chosen over per product so a filter never shows a product that cannot be bought in the chosen combination. Read time normalization was chosen over cleaning data on save so admins keep the spelling they typed and no backfill is needed.
