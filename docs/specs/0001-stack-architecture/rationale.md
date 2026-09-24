# 0001. Stack and architecture: rationale

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

BeStore is a single brand online store: a public storefront (browse, cart, guest card checkout, optional accounts) and an admin panel (catalog, orders, discounts, sales stats) for a few admins. It sells in one country, one language and one currency, with flat rate shipping. The storefront must be renderable for search engines from day one.

One developer builds it with AI help, in TypeScript, and wants managed, low ops hosting with a cheap start. Work proceeds as Tracer Bullet slices: each slice goes end to end through UI, server, database and payment. So the stack has to make a thin vertical thread cheap to build and deploy.

The workload is transactional: orders, stock, money, refunds and promo codes need relational integrity and all or nothing writes. Card data and sign in raise the security stakes. Payment is under PCI DSS (card security rules), and the goal is the smallest possible scope. Personal data (addresses, emails) means privacy rules apply; that part is handled in feature 16. Without a recorded stack, every later spec (data model, auth, payments, design system) would have nothing to build on.

## Options considered

### Option 1: One Next.js app on Vercel with Supabase and Prisma (chosen)

Next.js App Router monolith with storefront and admin route groups, Supabase for Postgres, auth and storage, Prisma for all DB access, Stripe Checkout, Resend (basis: framework and platform docs in the landscape check).

**Pros**:
- One deploy; one platform covers DB, auth and storage, so few vendors.
- Static rendering with revalidation handles SEO natively on Vercel.

**Cons**:
- Prisma and Supabase overlap (two migration systems, unused RLS client model).
- Serverless connection pooling and free tier pausing to manage.

### Option 2: Next.js on Vercel with Neon, Drizzle and Better Auth

Same app shape, with serverless Postgres (Neon), a SQL first ORM (Drizzle) and a self hosted auth library storing users in your own DB.

**Pros**:
- Everything, users included, lives in one schema managed by one tool; DB branching per preview deploy.
- Drizzle has no codegen step and a smaller runtime.

**Cons**:
- Needs a separate storage vendor for images, so one more service.
- You own more of auth (Better Auth is a library you run, not a managed service).

### Option 3: Monorepo with separate storefront and admin apps

Two Next.js apps plus shared `db` and `ui` packages in a pnpm workspace.

**Pros**:
- Admin releases cannot break the storefront; clearer ownership lines.

**Cons**:
- Two deploys, workspace tooling and duplicated auth setup for a solo developer, with no team boundary to justify it (basis: monolith first).

### Option 4: Standalone API service plus front ends

A Hono or Fastify API with an OpenAPI contract, consumed by separate storefront and admin UIs.

**Pros**:
- Ready for a mobile app or third party integrations.

**Cons**:
- The most code and infrastructure to build and run; no current consumer needs a public API.

## Rationale

The forces are a solo builder, Tracer Bullet slices, SEO from day one, money and stock integrity, and low ops. A monolith (Options 1 and 2) beats a split (Options 3 and 4) on every one of those. Each extra deployable multiplies setup and the release surface without a team boundary to justify it (basis: monolith first; premature microservices failure pattern). Next.js was chosen over TanStack Start and React Router because its static rendering plus on demand revalidation directly meets the SEO force on the chosen host, and it has the deepest commerce and integration ecosystem.

Between Options 1 and 2, the initial recommendation was Neon with Drizzle. You chose Supabase and Prisma, and that is a sound choice: Supabase supplies auth and storage in the same project, which removes two vendors and fits the low ops force better than Option 2's extra storage service and self hosted auth. What you accept is the overlap described in Consequences. It is contained by one rule: Prisma on the server is the only data path, RLS is on with no policies, and Prisma Migrate owns `public` (basis: single source of truth for access control). Prisma over Drizzle trades a codegen step and a heavier client for the most mature tooling; for CRUD heavy commerce this is fine, and reporting queries (the sales dashboard) can use raw SQL (basis: ORM for CRUD, SQL for complexity).

Stripe Checkout (hosted) over an embedded form keeps card data off BeStore entirely (SAQ A), and the webhook as the single source of payment truth protects against lost redirects (basis: PCI DSS scope reduction; idempotent webhook handling). No job queue yet, because no measured need exists (basis: premature optimisation failure pattern).

## References

**Project sources**:
- `docs/scope/scope.md`: product description, feature 1 done condition, the SEO requirement, Tracer Bullet approach, Beta workflow tier
- Landscape check cache: `docs/.agent-cache/research/stack-architecture.md` (2026-09-24)

**Practices & standards**:
- Monolith first; premature microservices failure pattern
- ORM for CRUD, SQL for complexity
- Single source of truth for access control (server side authorization)
- PCI DSS scope reduction via hosted payment pages (SAQ A)
- Idempotent webhook handling for money operations
- Integer minor units for currency amounts

**Links** (web verified during the landscape check):
- Next.js docs: https://nextjs.org/docs
- Prisma: https://www.prisma.io
- Stripe payments docs: https://docs.stripe.com/payments
- Resend: https://resend.com
- Drizzle ORM (Option 2): https://orm.drizzle.team
- Better Auth (Option 2): https://better-auth.com
- Neon (Option 2): https://neon.com
- TanStack Start comparison (framework alternative): https://tanstack.com/start/latest/docs/framework/react/comparison
- Supabase and Vercel: not web verified in this check, cited by name only
