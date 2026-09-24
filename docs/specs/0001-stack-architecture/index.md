# 0001. Stack and architecture for BeStore

**Date**: 2026-09-24
**Status**: Accepted

## Summary

BeStore will be one Next.js app written in TypeScript. It holds both the public storefront and the admin panel, and it is deployed to Vercel. Data lives in Supabase Postgres, reached only from server code through Prisma. Supabase also handles admin and customer sign in, plus product image storage. Card payments go through Stripe's hosted checkout page, and emails through Resend. This gives you one repo, one deploy and a few managed services, so you can build every slice end to end without running any servers yourself.

## Requirements

This is a decision spec. It records the stack, not implementation steps. The scaffold that makes the stack real belongs to scope feature 1, and `/develop` derives its steps from `## Proposed stack` and `## Architecture` below. The scope's done condition for feature 1 applies: the empty scaffold boots locally and passes build.

## Decision

**Chosen option**: Option 1: One Next.js app on Vercel with Supabase and Prisma

Build BeStore as a single Next.js (App Router) monolith (one deployable app) in TypeScript. It serves the storefront and `/admin` as separate route groups. It runs on Vercel, with Supabase for Postgres, auth and storage, Prisma as the only database access path, Stripe Checkout for payment and Resend for email.

**Implementation skills**: `prisma-database-setup`, `prisma-client-api`, `prisma-cli`, `prisma-driver-adapter-implementation` (`prisma/skills`, `.agents/skills/`) · `supabase`, `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `resend`, `react-email`, `email-best-practices` (`resend/resend-skills`, `.agents/skills/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Proposed stack

Versions: pin the current stable major of each package at scaffold time (for example Next.js 16.x and Prisma 7 or later, per the landscape check on 2026-09-24). Do not rely on these numbers without checking.

| Layer | Choice | Reason |
|---|---|---|
| Architecture pattern | Monolith: one app, storefront and admin as route groups | A solo builder at small scale gets one deploy, shared types and one DB layer; split nothing until a real bottleneck forces it. |
| Language | TypeScript (strict), end to end | One language across UI, server and schema; the widest ecosystem for AI assisted builds. |
| Runtime / toolchain | Node.js 24 LTS, pnpm | Matches Vercel's Node runtime; pnpm is fast and strict about dependencies. |
| Framework | Next.js, App Router | Server components plus static rendering meet the SEO requirement; server actions cover admin forms; first class Vercel, Stripe and Supabase support. |
| Rendering | Static with on demand revalidation for catalog pages; dynamic for cart, checkout, account and admin | Product and listing pages are fast and fully indexable, and they refresh the moment an admin edits a product. |
| API shape | Server actions for mutations; route handlers only for the Stripe webhook, the auth callback and cron | No separate API layer to maintain; typed calls end to end. |
| Primary DB | Supabase Postgres | Relational and ACID (safe, all or nothing writes) for orders, stock and money; the same project also provides auth and storage. |
| ORM / migrations | Prisma; Prisma Migrate owns the `public` schema | One schema file as the source of truth; raw SQL inside Prisma migrations for what Prisma cannot express (enable RLS, triggers). |
| Data access | Prisma on the server only; the browser never queries the DB | All access rules live in one place (server code). RLS (row level security) is enabled with no policies, so Supabase's public Data API exposes nothing. |
| Auth | Supabase Auth via `@supabase/ssr` (cookie sessions) | Already part of the chosen platform; covers admin sign in now and optional customer accounts later. The admin role model is decided in feature 5. |
| File storage | Supabase Storage, public `product-images` bucket | Same project and dashboard; images served through `next/image`. |
| Payments | Stripe Checkout (hosted page); webhook confirms the order | Least PCI scope (SAQ A, the lightest card security questionnaire); wallets and 3DS (bank verification) included; details in feature 7. |
| Email | Resend + React Email | Templates are React components in the repo; details in feature 11. |
| UI | Tailwind CSS + shadcn/ui | Accessible primitives copied into the repo, themeable for storefront and admin; the visual system is feature 4. |
| Forms / validation | Zod + React Hook Form | One Zod schema validates in the browser and again in the server action. |
| Cart | Postgres cart row, id held in a signed httpOnly cookie | Survives reload, guest first, can merge into an account later; the server checks price and stock. |
| Background jobs | None dedicated; Vercel Cron for periodic cleanup | The webhook does its work inline and idempotently; add a durable job tool only when a real need appears. |
| Observability | pino structured JSON logs + Vercel logs | Enough for now; error tracking and analytics are decided in feature 18. |
| Rate limiting | Supabase Auth built in limits (sign in and OTP only) + Vercel Firewall rate limit rules (checkout and promo routes) | No extra vendor; Firewall rules are added as those routes ship. |
| Testing | Vitest (unit and integration) + Playwright (end to end) | Vitest for pricing, stock and action logic; Playwright for buy flows and `/check verify`. |
| Hosting | Vercel | Native support for Next.js static rendering and revalidation, plus preview deploys per branch. |
| Environments | Local Supabase (CLI, Docker) · staging Supabase project for Vercel previews · production project for `main` | Isolated data per stage; Stripe runs in test mode everywhere except production. |

## Architecture

**Code layout** (thin routes, feature modules):

```
app/
  (store)/            public storefront routes (static where possible)
  admin/              admin routes, every page and action behind requireAdmin()
  api/
    stripe/webhook/   Stripe webhook (route handler)
    auth/callback/    Supabase auth callback
    cron/             Vercel Cron endpoints
src/
  features/<domain>/  catalog, cart, checkout, orders, discounts, ... (actions, queries, components, schemas)
  lib/                db (Prisma client), supabase (server/browser clients), env, logger, money, auth guards
  components/ui/      shadcn/ui components
emails/               React Email templates
prisma/               schema.prisma, migrations/
supabase/             Supabase CLI config (local stack, storage buckets, auth settings)
tests/e2e/            Playwright
```

Route files stay thin: they call into `src/features/*`. A feature module never imports from another feature's internals. Shared code goes in `src/lib`.

**Request and data flow**:
- Storefront pages read through Prisma in server components, are statically rendered, and are revalidated by tag (`revalidateTag`) from the admin actions that change the data.
- Mutations are server actions: validate with Zod, check auth, run a Prisma transaction, then revalidate.
- Payment: a server action creates the Stripe Checkout Session from the server side cart (prices come from the DB, never from the client). The customer pays on Stripe. The webhook marks the order paid; the redirect back to the store is display only.
- Images: an admin action checks `requireAdmin()`, then issues a Supabase signed upload URL. The browser uploads directly to Storage (this avoids Vercel's request body size limit), and the stored object path is saved through Prisma. Every upload gets a new, unique object path; an existing path is never overwritten, so the image CDN never keeps serving a replaced picture. `next.config` lists the Supabase Storage host in `images.remotePatterns`.
- Cart: the cart row and its cookie are created lazily inside the add to cart server action (server actions can set cookies; static pages cannot). No page render ever creates a cart.
- Sessions: the Next.js proxy (called middleware before Next.js 16) refreshes the Supabase auth session on every request, as `@supabase/ssr` requires, and redirects signed out visitors away from `/admin`. It is the refresh and first gate only; `requireAdmin()` remains the real check.
- Cron: `app/api/cron/*` handlers reject any request whose `Authorization` header is not `Bearer ${CRON_SECRET}` (the header Vercel Cron sends).

**Key invariants** (every slice must honour these):
- Money is stored as integer minor units (cents) in `Int` columns, with one store currency held in config; never floats. (Runner up: `Decimal`. Rejected because integers are simpler and exact for a single currency.)
- Timestamps are stored as UTC `timestamptz`. Dates shown to people and date ranges (dashboard periods, order dates) use the single store timezone from `STORE_TIMEZONE`.
- The browser never talks to Postgres. The Supabase service role key and the Prisma connection strings are only used server side (`import "server-only"`).
- Every admin page, server action and route handler calls `requireAdmin()` itself. Middleware (the proxy) is only a first redirect gate, never the only check.
- The Stripe webhook is the only thing that marks an order paid. It verifies the signature and is idempotent (processing the same event twice changes nothing), keyed on the Stripe event or session id.
- Stock changes happen inside a DB transaction with a conditional update, so stock never goes negative.
- Every table in `public` has RLS enabled with no policies, and the Prisma migration that creates a table enables RLS on it.
- App tables refer to Supabase users by a plain `uuid` column. Prisma does not manage foreign keys into the `auth` schema.

**DB connections** (serverless safe): the runtime `DATABASE_URL` uses the Supabase pooler in transaction mode (it shares a few DB connections across many short function calls). Migrations use `DIRECT_URL` (a direct or session mode connection). Reference for the exact settings (pooler flags, connection limit, where Prisma 7 and later reads the URLs): Prisma's "Supabase" database guide and the installed `prisma-database-setup` skill.

**Environments and secrets**:
- Every variable below is set separately per Vercel environment. Production gets the production Supabase project and live Stripe keys. Preview gets the staging Supabase project and Stripe test keys. Local development reads `.env.local`, which points at the local Supabase CLI stack and Stripe test keys.
- `.env*.local` is git ignored. A committed `.env.example` lists every variable with no values.
- Stripe webhooks: production has one endpoint on the production domain. Staging has one fixed endpoint on a stable staging domain (a Vercel alias for the `staging` branch), each with its own `STRIPE_WEBHOOK_SECRET`. Local development uses `stripe listen` forwarding. Random per branch preview URLs receive no webhooks, so payment flows are tested on staging or locally.
- The staging Supabase project on the free tier pauses when idle; move it to a paid tier once previews are relied on for review.

**Region**: put the Vercel functions and the Supabase projects in the same region, the one closest to the store's country. Vercel does not pick this for you: set the function region explicitly (project settings or `vercel.json`), or it stays on the default US region.

**Configuration required**:
- `DATABASE_URL`: Supabase pooled connection (transaction mode), used at runtime
- `DIRECT_URL`: direct or session connection, used by Prisma Migrate
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase auth client (anon key is safe to expose because RLS blocks table access)
- `SUPABASE_SERVICE_ROLE_KEY`: server only; storage signed URLs and admin user management
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: payments (feature 7)
- `RESEND_API_KEY`, `EMAIL_FROM`: email (feature 11)
- `CART_COOKIE_SECRET`: signs the cart cookie
- `CRON_SECRET`: authenticates Vercel Cron calls
- `STORE_CURRENCY` (ISO 4217, for example `EUR`), `STORE_TIMEZONE` (IANA, for example `Europe/Warsaw`), `NEXT_PUBLIC_SITE_URL` (canonical URLs, Stripe redirects, sitemap)

All of these are validated at boot by a Zod schema in `src/lib/env.ts`, so the app fails fast when one is missing. (Runner up: `@t3-oss/env-nextjs`, which does the same with an extra dependency.)

## Consequences

**Positive**:
- One repo, one deploy, one language: every Tracer Bullet slice can go through UI, action, DB and payment without crossing service boundaries.
- Few vendors (Vercel, Supabase, Stripe, Resend), all managed, all with free or low cost tiers to start.
- Catalog pages are static and indexable, so SEO holds from day one.
- The payment page is hosted by Stripe, so card data never touches BeStore (smallest PCI scope).

**Negative / tradeoffs**:
- Supabase and Prisma overlap: two migration systems exist and only Prisma's is used for `public`. Supabase's client side query and RLS model is deliberately unused. Anyone later adding `supabase.from(...)` queries would bypass the single access path, so treat that as off limits.
- Serverless limits apply: cold starts, per function time limits, and the need for the pooled connection. Long jobs cannot run inline; they need a job tool later.
- Supabase free projects pause after about a week idle, and Vercel Hobby is for non commercial use. Production needs paid plans (Supabase Pro, Vercel Pro) before launch.
- Hosted Stripe Checkout means less control over the payment page look than an embedded form.
- Admin and storefront share one deploy: a bad admin release can take the storefront down with it.

**Neutral**:
- Local development needs Docker (Supabase CLI).
- Vendor coupling to Vercel (revalidation and cron) and Supabase (auth); the code stays portable Next.js and Postgres, so both could be moved later with effort.

## Follow-up

- [ ] `/audit` records in root `AGENTS.md` `## Agent skills` the installed skills listed in `## Decision` (project wide: Prisma, Supabase, shadcn; area scoped: Resend and React Email belong in the email area's nested `AGENTS.md`), plus an `MCP servers:` line for Supabase, Stripe, Vercel and Playwright. Unused skills pulled in with those repos (`prisma-mongodb-upgrade`, `prisma-compute`, `prisma-postgres`, `prisma-postgres-setup`, `prisma-upgrade-v7`, `agent-email-inbox`, `migrate-radix-to-base`) do not apply to this stack.
- [ ] Before launch: upgrade production to Supabase Pro and Vercel Pro (free tiers pause, or forbid commercial use).
- [ ] Choose the hosting region once the selling country is confirmed; set `STORE_CURRENCY` and `STORE_TIMEZONE` to match.
- [ ] Feature 2 (`/audit`) captures these conventions in root `AGENTS.md` (feature modules, server only DB access, `requireAdmin()` in every admin entry point, money in cents, RLS on every table).
- [ ] Feature 3 (data model) builds on the invariants above (integer money, UTC timestamps, `uuid` user refs, RLS enabled).
- [ ] Feature 5 decides where the admin role lives (an app table vs a Supabase custom claim) and the shape of `requireAdmin()`.
- [ ] Revisit a durable job tool (for example Inngest) if webhook to email work ever needs retries beyond Stripe's own webhook retries.
