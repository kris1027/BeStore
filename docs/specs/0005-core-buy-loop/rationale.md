# 0005. Core buy loop: rationale

Decision record for [index.md](index.md). `/develop` builds from `index.md`; this file keeps the why.

## Context

> ⚠️ Premise note: this slice turns on a project wide rendering mode (Cache Components) inside a feature. That is deliberate: the storefront is the first code that needs caching, and a caching model chosen later would mean rewriting these pages. The cost is a small refit of the existing admin and auth routes in milestone 1, done first so a broken build shows up before any feature code lands.

BeStore has its schema (spec 0002), design system (0003) and admin sign in (0004), but nothing a customer can see or buy. Scope feature 6 is the thinnest thread from an admin adding a product to a customer holding it in a cart at checkout. Feature 7 then adds payment. Everything built here is on the path of every future sale, so the rules it sets (where prices come from, how stock is checked, how catalog pages stay fresh) become the rules the rest of the store follows.

The forces are specific. Spec 0001 requires the storefront to be static for speed and search engines, and to refresh on demand when an admin edits the catalog. It also fixes the cart as a Postgres row found through a signed cookie, created only in a server action, and forbids trusting client prices. The header needs a live cart count on every page, which is per visitor data; in Next.js 16, reading a cookie while rendering makes a whole page dynamic unless the rendering model isolates that read. Stock changes outside the admin too (payment in feature 7), so the freshness story must work from a webhook as well as from an admin action.

On the admin side, feature 9 will own full catalog management (edit, hide, reorder, categories, several images). This slice must create real products with variants without building that editor twice. The data model already stores variants as combinations of option values with an `option_key`, which fixes how the form must produce them. The project is a single developer building at Beta rigor, so each piece must be testable end to end in CI against a real local Supabase stack.

## Options considered

### Option 1: Cache Components catalog, server action cart in Postgres (chosen)

Turn on `cacheComponents`. Catalog reads are `'use cache'` functions tagged per list and per product; the admin action expires them with `updateTag`. The cart count, cart page and checkout page read the cookie inside Suspense boundaries, so they stream in while the rest of the page comes from the static shell. Cart changes are server actions that lock the cart row, read live price and stock, and write.

**Pros**:
- Matches spec 0001 exactly: static catalog, on demand refresh, server side cart.
- The header count renders on the server with the page, with no client fetch and no empty flash.
- `updateTag` gives the admin read your own writes: the product is live on the next request.
- It is the model Next.js 16 documents first, so later features follow current docs.

**Cons**:
- Changes build rules for every route: request data must sit in Suspense, `new Date()` cannot run in the shell, existing admin and auth routes need `instant = false`.
- `generateStaticParams` cannot return an empty list, which needs a sentinel for an empty catalog.
- Stock shown on cached pages can lag until a tag is expired.

### Option 2: Previous caching model with a client fetched cart count

Keep the config as is. Wrap Prisma reads in `unstable_cache` with tags and expire them with `revalidateTag`. Pages stay static because nothing on them reads cookies; the header count is a client component that calls a server action after load.

**Pros**:
- No change to existing routes; no build rule surprises.
- Well known model with years of examples.

**Cons**:
- Builds new code on the API Next.js now labels the previous model, so a migration comes later anyway, over more code.
- The count appears after hydration (a visible flash, an extra request per page view).
- Two ways to read cart data (server for `/cart`, client call for the badge) that must agree.

### Option 3: Dynamic storefront

Render every storefront page on request, reading Prisma each time, with no caching layer.

**Pros**:
- Simplest to build and reason about; stock is always exact.
- No tags to remember in feature 7.

**Cons**:
- Breaks spec 0001's static catalog decision; every view hits the database.
- Slower pages and worse Core Web Vitals, which hurts search ranking for a store.

### Option 4: Browser side cart

Keep the cart in `localStorage` and send it to the server only at checkout; catalog pages fully static.

**Pros**:
- No cart rows, no cookie signing, no cron; pages stay static with a client badge.
- Works offline and costs no database writes.

**Cons**:
- Contradicts spec 0001 (Postgres cart that later merges into an account).
- Prices and stock in the cart are whatever the browser holds until checkout, so errors surface late.
- Carts do not follow a customer across devices once accounts exist (feature 12).

## Rationale

Option 1 is the only one that satisfies spec 0001's two load bearing requirements at once: static, instantly refreshed catalog pages and a server side cart whose count shows on every page. Option 2 meets them on paper but pays with a client fetch on every page view and a second cart read path, and it invests new code in the caching API that Next.js 16 treats as the previous model. Option 3 gives up the static storefront that search visibility depends on. Option 4 moves price and stock truth to the browser, which spec 0001 rules out.

The refit cost of Option 1 is small and bounded: existing admin and auth pages opt out with `instant = false` and keep working as today, one footer line moves into a cached component, and the build proves it before any feature code. Stale stock on a cached page is acceptable because the add to cart action rechecks stock under a row lock and the cart flags lines at read time; the customer can never pay for stock that does not exist (feature 7 rechecks again). The tag contract in `src/lib/cache-tags.ts` makes the webhook's job in feature 7 explicit.

Smaller calls made while writing:

- **Row lock on cart writes** (`SELECT ... FOR UPDATE` on the cart, then read and upsert the line) so two tabs cannot pass the cap. Runner up: a single `INSERT ... ON CONFLICT DO UPDATE SET quantity = LEAST(...)` in raw SQL, faster but it hides the stock read and needs raw SQL for a simple rule.
- **Cart core in `src/lib/cart/`** because cart, checkout (7) and accounts (12) all read it and features may not import each other's internals. Runner up: checkout inside the cart feature, which would grow into payment code.
- **`refresh()` after cart actions** to rerender the badge and cart page; the cart is request data, not a cache tag. Runner up: tag the cart per id with `use cache: private`, more moving parts for data read once per request.
- **Only availability labels reach the browser** (`in_stock`, `low(n)`, `sold_out`), so exact counts above 5 are not public. Runner up: send the count and hide it in the UI, which leaks it to anyone reading the payload.
- **Image dimensions read in the browser** and stored as layout hints. Runner up: read them on the server by downloading the file, which costs a round trip for data that only prevents layout shift.
- **`dangerouslyAllowLocalIP` only for a loopback Supabase host**, so the image optimizer works locally and in CI without opening the SSRF door (a server fetching internal addresses) in production. Runner up: `unoptimized` images whenever the host is local, which makes local pages behave differently from production.
- **Reserved slug fallback in `generateStaticParams`** so builds pass on an empty database (first deploy, CI). Runner up: seed before every build, which the production deploy cannot do.
- **Price minimum of one minor unit**: a product at 0 would lead to an order total of 0, which the database and Stripe both refuse (spec 0002). Stripe's minimum charge is feature 7's concern.
- **Admin list capped at 200** instead of paging now: a new store has few products and feature 9 rebuilds the list. The expert rule on paging is honored by the cap and the follow up.

## Addendum (2026-09-26): status codes and kept pages under Cache Components

The first build run found that turning on Cache Components broke two promises from spec 0004, and that `instant = false` does not help. Every dynamic route now streams its static shell (the root layout) before the page runs, so a `notFound()` in `requireAdmin()` arrives after the `200` status is already sent: signed in non admins got the right 404 page with the wrong status (spec 0004 AC-6). Cache Components also keeps recently visited routes alive in the browser, so after sign out (a router redirect from a server action) pressing Back showed the admin page again (spec 0004 AC-8). The same shell first streaming makes unknown product slugs a soft 404. The Next.js 16 docs (`not-found.md`, `loading.md` Status codes, `streaming.md` The HTTP contract) say a real status now has to come from the proxy.

**Admin 404.** Options: (1) the proxy runs the same `decideAdminAccess()` with the `admin_users` row, before anything streams (chosen); (2) accept a soft 404 and relax spec 0004 AC-6; (3) turn Cache Components off and rebuild the catalog caching on `unstable_cache` with a client fetched cart count. Option 1 keeps every spec 0004 promise and the Cache Components catalog, at the cost of one primary key read per admin request, which is tiny for a panel used by a few admins. It reuses the pure rule set, so there is still one definition of who may enter; `requireAdmin()` stays the authoritative check (the proxy trusts `getClaims()`, a local token check). Option 2 lets a signed in customer (feature 12) tell `/admin` apart from a missing page. Option 3 throws away the reason 0005 chose Cache Components (a static catalog with a server rendered cart count).

**Sign out.** Options: (1) a plain form POST to a route handler that answers 303, so the browser does a full document load (chosen); (2) keep the server action but return instead of redirecting, and call `window.location.replace` in the client. Option 1 needs no JavaScript, which spec 0004 promises for the MFA page button, and a full load is the only thing that clears the kept routes. It gives up the server action's built in Origin check, so the handler checks `Origin` itself; that is a few lines and a unit test. Spec 0004 had already named a full navigation as the fallback if the router cache restored the page.

**Product 404.** A real status for product slugs would need a database read in the proxy on every product request, before the cache, which defeats static serving and breaks the rule that the proxy never runs on storefront routes. The soft 404 carries `noindex`, so search engines drop it; visitors see the same page. Accepted.
