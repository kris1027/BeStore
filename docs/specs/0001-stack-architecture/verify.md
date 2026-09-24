# Verify: Stack & architecture · spec 0001 · updated 2026-09-24
_This is a decision spec with no numbered acceptance criteria, so these steps come from the scope's done condition ("the empty scaffold boots locally and passes build") and the spec's `## Architecture`. `/check verify` runs these; `/test` locks the ones that should keep passing._

## Commands
- [x] `pnpm install` → finishes clean, and `postinstall` generates the Prisma client into `src/generated/prisma` → done condition (boots)
- [x] `pnpm db:start` → the local Supabase stack starts on the 553xx ports (API 55321, DB 55322, Studio 55323) and logs `Creating Storage bucket: product-images` → Architecture (storage)
- [x] `echo 'SELECT 1;' | pnpm exec prisma db execute --stdin` → `Script executed successfully` (Prisma reaches the DB through `DIRECT_URL`) → Architecture (DB connections)
- [x] `pnpm typecheck` → exits 0 → done condition (build)
- [x] `pnpm lint` → exits 0 → done condition (build)
- [x] `pnpm build` → exits 0, and `/` is listed as `○ (Static)` → done condition (build) + Rendering (static storefront)
- [x] `STORE_CURRENCY=euro pnpm dev`, then request `/` → the server logs `Invalid environment variables` naming `STORE_CURRENCY` (the env check runs at boot) → Architecture (env validated at boot)

## UI / manual
- [x] `pnpm dev`, open `http://localhost:3000/` → the page shows the "BeStore" heading and "The storefront is coming soon." → done condition (boots)
- [x] Open Studio at `http://127.0.0.1:55323` → Storage lists a public `product-images` bucket → Architecture (storage)
- [x] `git status` → `.env.local` is not listed (ignored), `.env.example` is tracked or can be tracked → Environments and secrets

## Acceptance-criteria coverage
- Done condition "boots locally": `pnpm install`, `pnpm db:start`, the dev server step, the env boot check
- Done condition "passes build": typecheck, lint, build
- Spec architecture points checked in the scaffold: static storefront route, env validation at boot, Prisma connection, storage bucket, env files kept out of git
