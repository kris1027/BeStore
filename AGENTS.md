<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BeStore

Single brand online store: storefront (guest or account checkout, card payment) plus an `/admin` panel, in one Next.js app.

## Stack

- **Language / Runtime**: TypeScript (strict), Node.js 24 LTS
- **Framework**: Next.js 16 (App Router), React 19; monolith with `(store)` and `admin` route groups, deployed to Vercel
- **Data**: Supabase Postgres via Prisma 7 (`@prisma/adapter-pg`), server only; Supabase Auth (`@supabase/ssr`) and Storage
- **Key dependencies**: Zod + React Hook Form, Tailwind CSS 4 + shadcn/ui, Stripe Checkout, Resend + React Email, pino logs
- **Testing**: Vitest (unit, integration) + Playwright (e2e)
- **Package manager**: pnpm
- Full decision and invariants: [docs/specs/0001-stack-architecture/index.md](docs/specs/0001-stack-architecture/index.md)

## Build approach

**Tracer Bullet**: prove one real thread through every layer first, then thicken one segment at a time, each slice shipped end to end.

## Commands

```bash
pnpm install                 # also runs prisma generate
pnpm db:start                # local Supabase stack (needs Docker); db:stop to stop
pnpm db:migrate              # prisma migrate dev
pnpm dev                     # dev server
pnpm build
pnpm lint && pnpm typecheck
pnpm exec vitest run         # unit + integration (*.test.ts beside the source)
pnpm exec playwright test    # e2e (tests/e2e/*.spec.ts)
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title/index.md`. Scope lives in `docs/scope/scope.md`.

## Rules

- **Functional style**: plain functions and immutable data (`const`, `readonly`), no classes where a function works, no shared mutable module state. Pure logic (pricing, stock, discounts) stays free of I/O; DB, Stripe, email and cookies live at the edges (server actions, route handlers).
- **Expected failures are values**: server actions return a typed `{ ok: true, data } | { ok: false, error }` result; `throw` only for bugs and broken invariants.
- **Types**: strict plus `noUncheckedIndexedAccess`; no `any` (use `unknown` and narrow). Validate every external input with Zod.
- **Layout**: route files in `app/` stay thin and call `src/features/<domain>/` (actions, queries, components, schemas). A feature never imports another feature's internals; shared code goes in `src/lib/`. Import via `@/`.
- **Named exports only**, except where Next.js needs a default (page, layout, route, config files).
- **Data access**: Prisma only, server only (`import "server-only"`); never `supabase.from(...)`. Every new table's migration enables RLS with no policies.
- **Security**: every admin page, action and route handler calls `requireAdmin()` itself; the proxy is only a first gate. Prices always come from the DB, never the client. Only the Stripe webhook marks an order paid, idempotently.
- **Money and time**: integer minor units (cents) in `Int` columns, never floats; timestamps in UTC `timestamptz`, shown in `STORE_TIMEZONE`.
- **Env**: every variable is added to the Zod schema in `src/lib/env.ts` and to `.env.example`.
- **UI**: WCAG AA baseline on storefront and admin (labels, keyboard use, visible focus, contrast).
- **Comments**: explain the why (invariants, gotchas), not the what.
- **Tests**: each feature ships Vitest tests for its logic and server actions plus Playwright for its user flows.
- **Commits**: Conventional Commits, e.g. `feat(cart): ...`, `fix(env): ...`.

## Tooling

Chosen here, installed by `/develop tooling`:
- ESLint (Next.js config, `@typescript-eslint/no-explicit-any: error`) + Prettier with `prettier-plugin-tailwindcss`; scripts `format`, `format:check`, `test`.
- Pre commit (simple-git-hooks + lint-staged): lint and format staged files, then `pnpm typecheck`.
- CI: GitHub Actions on push and PR: install, lint, format check, typecheck, Vitest (Playwright once flows exist).

## Git

- integration: on
- branch prefix: feat/
- commit: per-milestone

## Agent skills

- [prisma-database-setup](.agents/skills/prisma-database-setup/): `prisma/skills`, Prisma with Supabase Postgres (pooler, `DIRECT_URL`)
- [prisma-client-api](.agents/skills/prisma-client-api/): `prisma/skills`, queries, filters, transactions
- [prisma-cli](.agents/skills/prisma-cli/): `prisma/skills`, generate, migrate, studio
- [prisma-driver-adapter-implementation](.agents/skills/prisma-driver-adapter-implementation/): `prisma/skills`, the `pg` driver adapter
- [supabase](.agents/skills/supabase/): `supabase/agent-skills`, Auth, Storage, CLI, `@supabase/ssr`
- [supabase-postgres-best-practices](.agents/skills/supabase-postgres-best-practices/): `supabase/agent-skills`, schema, indexes, RLS, migrations
- [shadcn](.agents/skills/shadcn/): `shadcn-ui/ui`, adding and styling UI components

Not for this stack (pulled in with the repos above): prisma-mongodb-upgrade, prisma-compute, prisma-postgres, prisma-postgres-setup, prisma-upgrade-v7, agent-email-inbox, migrate-radix-to-base.
MCP servers: Supabase (connected), Stripe (connected), Vercel (connected), Playwright (connected)

## Context files

- [emails/AGENTS.md](emails/AGENTS.md): React Email templates sent through Resend

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
