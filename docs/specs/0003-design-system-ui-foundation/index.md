# 0003. Design system and UI foundation for BeStore

**Date**: 2026-09-25
**Status**: Accepted

## Summary

This spec sets the look and the shared building blocks for both the storefront and the admin panel: a minimal, editorial style (lots of white space, near black on white, a serif for storefront headings), built on shadcn/ui with Base UI underneath (the library that handles keyboard and screen reader behavior). BeStore is a template, so everything that makes it a brand (name, fonts, colors) lives in a few known places and a rebrand touches nothing else. It ships the tokens, a core component set, both page shells, a price formatter, error pages, a `/style-guide` page that shows it all, and automatic accessibility checks (axe) that keep it at WCAG AA.

## Requirements

**User stories**:
- As the builder of each later slice, I want tokens, components and page shells ready, so a new page only composes them and never invents a look.
- As someone turning this template into a real store, I want to change the name, fonts and colors in a few known files, so a rebrand takes minutes and misses nothing.
- As a shopper using a keyboard or a screen reader, I want every page to be reachable, readable and clearly focused, so I can shop without a mouse.
- As an admin, I want the panel to share the same calm, readable system, so it is quick to scan and use.

**Acceptance criteria**:
- **AC-1**: shadcn/ui is initialized with base `base` (Base UI), style `vega`, base color `neutral`, icon library `lucide`, Tailwind v4 CSS variables, and `components.json` committed. `app/globals.css` holds the tokens in `## Feature design` (near black primary, neutral grays, radius `0.25rem`). Inter (`--font-sans`) and Newsreader (`--font-heading`) load through `next/font` and are self hosted (no request to Google at runtime). No dark tokens and no `dark:` classes ship.
- **AC-2**: `docs/design.md` exists and covers brand direction, every color token with its measured contrast ratio, the type scale, spacing and layout (container, breakpoints), radius, product image ratio, motion, focus style, the component inventory with usage rules, and a rebrand checklist.
- **AC-3**: Every foreground and background token pair used for text meets 4.5:1 (3:1 for large text, 24px, or 18.66px bold). Form control borders (`--input`) and the focus ring (`--ring`) meet 3:1 against the page background. `docs/design.md` lists each pair with its ratio.
- **AC-4**: The core component set in `## Feature design` is installed in `src/components/ui/` and each component appears on `/style-guide` in the states that apply to it, per the component states table in `## Feature design` (for example Button: default, focus, disabled, loading; Badge: its variants only).
- **AC-5**: `/style-guide` and `/style-guide/admin` render in local dev and on Vercel preview deploys. With `VERCEL_ENV=production` both return 404. Both send `robots: noindex`.
- **AC-6**: Every page in the `(store)` group renders the storefront shell: a skip link as the first tab stop that moves focus to `<main id="main">`; a sticky header with the wordmark (links to `/`), the nav from `storeNavItems`, and an actions slot; a footer with the wordmark, `© <year> <brand name>`, a links slot, and the contact email when `brand.contactEmail` is set. Below the `md` breakpoint the nav moves into a Sheet opened by a button labeled "Open menu"; the button is hidden when `storeNavItems` is empty.
- **AC-7**: `AdminShell` renders a sidebar from the `nav` prop (the current item marked `aria-current="page"`: the item whose `href` equals the pathname or is a prefix of it followed by `/`, so `/admin/orders/123` marks Orders), a top bar with the sidebar trigger, the wordmark plus an "Admin" label, and a user menu slot. Below `md` the sidebar becomes an off canvas sheet. This feature creates no `/admin` route; the shell is shown only on `/style-guide/admin`.
- **AC-8**: By keyboard alone, every interactive element on `/`, `/style-guide` and `/style-guide/admin` is reachable in reading order and shows a visible focus indicator (2px `--ring` outline, 2px offset) that the sticky header never covers. Dialog and Sheet trap focus, close on Escape, and return focus to their trigger.
- **AC-9**: axe (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) reports zero violations on `/`, `/style-guide`, `/style-guide/admin` and a not found page, on desktop and phone viewports, including with the mobile nav Sheet open and a Dialog open.
- **AC-10**: `formatMoney(cents, { currency, locale })` formats integer minor units with the currency's own fraction digits: `1999` EUR in `en` gives `€19.99`, `1999` JPY gives `¥1,999`, `-500` EUR gives `-€5.00`. A non integer `cents` throws (a bug, never user input). `<Price cents={…} />` uses `STORE_CURRENCY` and `STORE_LOCALE` by default; a `currency` prop overrides the currency (for orders, which store their own).
- **AC-11**: `STORE_LOCALE` is in the Zod env schema and `.env.example`: a BCP 47 language tag (for example `en`, `en-GB`, `pl-PL`) that `Intl` supports, defaulting to `en` when unset; an invalid value fails boot with a clear message. `<html lang>` equals it.
- **AC-12**: A rebrand needs edits only in `src/lib/brand/brand.ts`, `src/lib/brand/fonts.ts` and the token block in `app/globals.css`. A Vitest check fails when any file under `app/` or `src/` (outside `src/lib/brand/` and `src/components/ui/`) uses a raw Tailwind palette color class (for example `bg-neutral-900`, `text-red-600`) or the store name. The test reads the name from `brand.name` at run time and matches it as a whole word, case sensitive.
- **AC-13**: `app/not-found.tsx`, `app/error.tsx` and `app/global-error.tsx` show an on brand heading, a short plain message, and a link home; the error page also offers "Try again" (calls `retry()`, which fetches and renders again; Next 16.3 prefers it over `reset`). `global-error` renders its own `<html lang>` and `<body>` with the fonts and tokens, and exposes no error message or stack to the visitor.
- **AC-14**: `public/placeholder.svg` (a neutral image placeholder) exists, and an `aspect-product` utility (4:5, from the `--aspect-product` token) is available and shown on `/style-guide`.
- **AC-15**: With `prefers-reduced-motion: reduce`, component transitions and animations are turned off (Sheet, Dialog and toast appear without sliding or fading).
- **AC-16**: The Playwright accessibility and keyboard tests run in CI on every PR, against a production build (`pnpm build && pnpm start`) with the env values from `tests/valid-env.ts` and `VERCEL_ENV` unset. Locally, Playwright keeps using `pnpm dev`.

## Decision

**Chosen option**: Option 1: shadcn/ui on Base UI with CSS tokens, one shared theme, and a style guide route checked by axe

One light theme, defined as CSS variables in `app/globals.css`, drives shadcn components (style `vega`, Base UI primitives, Lucide icons) for both the storefront and the admin; brand identity lives in `src/lib/brand/` plus the token block, and a `/style-guide` route (hidden in production) is the living showcase that Playwright and axe check for WCAG AA.

**Implementation skills**: `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `accessibility` (`addyosmani/web-quality-skills`, `.agents/skills/accessibility/`) · `playwright-best-practices` (`currents-dev/playwright-best-practices-skill`, `.agents/skills/playwright-best-practices/`) · `tailwind-4-docs` (`lombiq/tailwind-agent-skills`, `.agents/skills/tailwind-4-docs/`) · `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`)

**Decisions made in the design conversation** (fixed inputs):
- Design source: no design yet; this spec sets the direction. Brand feel: minimal and editorial. Product range: none specific (a template), so nothing assumes a product type.
- Primitives: Base UI. Style: Vega. Neutrals: `neutral` (pure gray). Color: near black primary, no accent. Radius: small, `0.25rem`. Icons: Lucide. Dark mode: light only for now.
- Fonts: Newsreader for storefront headings, Inter for body text and all admin text.
- Wordmark: the store name set in the heading font (no logo file yet).
- Rebrand home: `src/lib/brand/` plus the CSS token block.
- Shells: storefront and admin both ship now. Header: wordmark left, nav middle, actions right. Footer: wordmark, copyright, links slot. Admin nav: only built sections; each feature adds its entry.
- Showcase: `/style-guide`, 404 in production. Components: the core set for Slices 1 to 3. Accessibility: axe in Playwright.
- Locale: `STORE_LOCALE` env var, default `en`. Commerce UI: price formatter and `Price` only. Image ratio: 4:5. Placeholders: one local SVG.
- `design.md` lives at `docs/design.md`. Error pages: not found, error, global error.

**Decisions made in this spec** (recommended, with the runner up):
- **Fonts live in `src/lib/brand/fonts.ts`, apart from `brand.ts`.** `next/font` must run in module scope of app code, and `brand.ts` must stay importable from React Email templates (feature 11), which cannot load `next/font`. So a rebrand touches three files, not two. Runner up: one `brand.ts` holding the fonts too, which breaks email reuse.
- **Contrast fixes to the shadcn neutral defaults**: `--muted-foreground` darkens to `oklch(0.5 0 0)` (the default `0.556` is 4.34:1 on `--muted`, below AA), and a new darker `--input` `oklch(0.62 0 0)` gives form borders 3:1 (the default `0.922` is about 1.2:1, failing WCAG 1.4.11). `--border` stays light for decorative lines only. Runner up: keep defaults and never put muted text on muted surfaces, which is a rule nobody remembers.
- **`<Price>` is a client safe component reading a `StoreFormatProvider`** (locale and currency) mounted in the root layout from env. It then works in server and client components (the cart will update on the client). Runner up: a server only `Price` reading `env` directly, which the cart could not use.
- **Style guide gate is `VERCEL_ENV === "production"`**, checked in `app/style-guide/layout.tsx` (calls `notFound()`). Local `pnpm build && pnpm start` still shows it, which is harmless. Runner up: `NODE_ENV`, which is `production` on preview deploys too and would hide it there.
- **Sticky storefront header** with `scroll-padding-top` equal to its height, so focused elements and anchor targets are never hidden under it (WCAG 2.4.11). Runner up: a static header, which avoids the issue but loses the always visible cart.
- **Admin nav is a prop, the list is a constant**: `AdminShell` takes `nav: readonly AdminNavItem[]`; `adminNavItems` in `src/components/layout/admin-nav.ts` starts empty and each admin feature appends its entry. `storeNavItems` works the same way. Runner up: each feature registers itself at runtime, which is shared mutable module state (against the rules).
- **Touch targets**: at least 44 by 44px for storefront controls (header actions, menu button, primary buttons on phones); admin keeps the Vega sizes (at least 24px, WCAG 2.5.8). Runner up: 24px everywhere, which passes AA but is fiddly on phones.
- **Design lint as a Vitest test**, not a custom ESLint rule: a regex scan over `app/` and `src/` for raw palette classes and the literal store name. Cheap, readable, runs in `pnpm test`. Runner up: an ESLint plugin, more precise but more code to maintain.
- **Playwright gets a second project, `mobile` (Pixel 7)**, so phone layouts are tested, and CI runs the e2e suite against `pnpm build && pnpm start` with placeholder env values (no database needed for these pages). Runner up: a desktop only run, which misses the mobile nav entirely.
- **Copyright year is computed at render in `STORE_TIMEZONE`.** On a statically rendered page it is frozen at build time until the next deploy; acceptable for a year.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**: none. This feature adds no tables and no migration. Brand identity is code (`src/lib/brand/`) and CSS tokens, reviewed in git.

**Tokens** (light only, OKLCH, in `:root` in `app/globals.css`, mapped to Tailwind with `@theme inline`; the `.dark` block shadcn generates is removed):

| Token | Value | Use | Contrast target |
|---|---|---|---|
| `--background` | `oklch(1 0 0)` | page | |
| `--foreground` | `oklch(0.145 0 0)` | body text | 4.5:1 on background, muted, card |
| `--card`, `--popover` | `oklch(1 0 0)` | surfaces | |
| `--card-foreground`, `--popover-foreground` | `oklch(0.145 0 0)` | text on surfaces | 4.5:1 |
| `--primary` | `oklch(0.205 0 0)` | buttons, active nav | |
| `--primary-foreground` | `oklch(0.985 0 0)` | text on primary | 4.5:1 on primary |
| `--secondary`, `--muted`, `--accent` | `oklch(0.97 0 0)` | quiet fills, hover | |
| `--secondary-foreground`, `--accent-foreground` | `oklch(0.205 0 0)` | text on quiet fills | 4.5:1 |
| `--muted-foreground` | `oklch(0.5 0 0)` | secondary text | 4.5:1 on background and on muted (about 6.0 and 5.5) |
| `--destructive` | `oklch(0.505 0.213 27.518)` | errors, destructive buttons | 4.5:1 as text on background and with white text |
| `--border` | `oklch(0.922 0 0)` | decorative dividers only | none (decorative) |
| `--input` | `oklch(0.62 0 0)` | form control borders, checkbox, radio | 3:1 on background |
| `--ring` | `oklch(0.205 0 0)` | focus outline | 3:1 on background |
| `--radius` | `0.25rem` | base radius; shadcn derives `sm` to `xl` from it | |
| `--aspect-product` | `4 / 5` | product images (`aspect-product`) | |
| `--header-height` | `3.5rem` below `md`, `4rem` from `md` | storefront header height; `html { scroll-padding-top: var(--header-height) }` uses the same token | |
| `--font-sans` | Inter (from `next/font`) | body, all admin text, UI controls | |
| `--font-heading` | Newsreader (from `next/font`) | storefront h1 to h3 and the wordmark | |
| `--sidebar-*` | shadcn neutral defaults, with `--sidebar-ring` = `--ring` | admin sidebar | same targets as above |

Values are the starting point; `/develop` measures each pair (axe plus a contrast calculation) and adjusts lightness if a target fails, then records the final ratios in `docs/design.md`.

**Typography**: Tailwind's default scale. Body `text-base` (16px) minimum, line height 1.5 for body. Storefront h1 `font-heading text-4xl md:text-5xl`, h2 `font-heading text-3xl`, h3 `font-heading text-2xl`; admin headings use `font-sans font-semibold` (`text-2xl` page title). One `h1` per page. Newsreader weights 400 and 500 (plus italic 400); Inter as a variable font. `display: swap`.

**Layout**: mobile first, Tailwind default breakpoints (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). Storefront container `mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8`. Spacing on Tailwind's 4px grid; vertical rhythm between page sections `py-12 md:py-16`. Layout uses `flex`/`grid` with `gap-*` (no `space-*`, per the shadcn skill).

**Motion**: short and quiet, at most 200ms, only the shadcn defaults (from `tw-animate-css`). A global `@media (prefers-reduced-motion: reduce)` rule sets animation and transition durations to `0.01ms` (not `0`, so Base UI still receives the end events it waits for before unmounting a closed Sheet, Dialog or toast).

**Focus**: `focus-visible` only (not on mouse click): 2px solid `--ring` outline with 2px offset, on every interactive element, including links in prose. Never `outline: none` without a replacement.

**Core component set** (added with the shadcn CLI into `src/components/ui/`, then reviewed per the skill's rules): `button`, `input`, `textarea`, `label`, `field`, `select`, `checkbox`, `radio-group`, `card`, `badge`, `alert`, `dialog`, `sheet`, `dropdown-menu`, `toast` (the Base UI flavor, per the skill), `table`, `sidebar`, `skeleton`, `spinner`, `empty`, `separator`. Forms follow the skill: `FieldGroup` plus `Field`, `data-invalid` on `Field`, `aria-invalid` on the control, wired to React Hook Form and Zod when a feature adds a form. Buttons show loading with `Spinner` plus `disabled`, never a custom prop.

**Component states shown on `/style-guide`** (and repeated in `docs/design.md`):

| Component | States |
|---|---|
| Button | each variant and size; focus; disabled; loading (Spinner plus disabled) |
| Input, Textarea, Select | default with Label; focus; disabled; invalid (with error text); Select open |
| Checkbox, Radio group | unchecked; checked; focus; disabled; invalid |
| Field | with description; invalid with error message |
| Card | full composition (header, title, description, content, footer) |
| Badge | each variant |
| Alert | default; destructive |
| Dialog, Sheet | closed trigger; open (Title present) |
| Dropdown menu | closed; open with groups; a disabled item |
| Toast | triggered by a button; success and error |
| Table | with rows; with the Empty state inside |
| Sidebar | shown on `/style-guide/admin` only; expanded; collapsed; phone off canvas |
| Skeleton, Spinner, Empty, Separator | default only |

**Shared app components** (outside `ui/`, owned by this feature):

| Path | What |
|---|---|
| `src/lib/brand/brand.ts` | `brand = { name, contactEmail }` (readonly, `contactEmail: string \| null`). No `next/*` imports, so emails can use it. |
| `src/lib/brand/fonts.ts` | `fontSans` (Inter), `fontHeading` (Newsreader) from `next/font/google`, variables `--font-sans`, `--font-heading`. |
| `src/lib/money.ts` | `formatMoney(cents, { currency, locale })`, pure, no I/O. |
| `src/components/store-format-provider.tsx` | client context holding `{ locale, currency }`. |
| `src/components/price.tsx` | `<Price cents currency? className? />`. |
| `src/components/wordmark.tsx` | brand name in `font-heading`, a link to `/`. |
| `src/components/layout/store-shell.tsx` | skip link, header (with mobile Sheet nav), `<main id="main" tabIndex={-1}>`, footer. Props: `actions?`, `footerLinks?`, `children`. |
| `src/components/layout/store-nav.ts` | `storeNavItems: readonly { href, label }[]` (starts empty). |
| `src/components/layout/admin-shell.tsx` | shadcn `SidebarProvider` + `Sidebar` + top bar. Props: `nav`, `userMenu?`, `children`. |
| `src/components/layout/admin-nav.ts` | `AdminNavItem` type (`href`, `label`, `icon`), `adminNavItems` (starts empty). |
| `public/placeholder.svg` | neutral 4:5 placeholder, no text inside. |

**Routes and files**:

| Route / file | Kind | Key content | Access | Key errors |
|---|---|---|---|---|
| `app/layout.tsx` | root layout | `<html lang={env.STORE_LOCALE}>`, font variables on `<html>`, `StoreFormatProvider`, `Toaster`, metadata title template `%s · ${brand.name}`, default `brand.name` | public | boot fails on invalid env |
| `app/(store)/layout.tsx` | layout | wraps children in `StoreShell` | public | |
| `app/(store)/page.tsx` | page | keeps today's placeholder content inside the shell | public | |
| `/style-guide` (`app/style-guide/page.tsx`) | page | tokens with contrast ratios, type scale, spacing, radius, every component in its states, a sample form with validation, Price examples (EUR, JPY, negative), placeholder in `aspect-product`, a Dialog, a Sheet, a toast trigger; rendered inside `StoreShell` with demo nav and actions | public except production | 404 when `VERCEL_ENV=production` |
| `/style-guide/admin` | page | `AdminShell` with demo nav items and sample table content | same | same |
| `app/style-guide/layout.tsx` | layout | the production gate, `robots: { index: false }` | | |
| `app/not-found.tsx` | page | heading, message, link home, inside `StoreShell` | public | returns 404 |
| `app/error.tsx` | client boundary | heading, message, "Try again" (`retry()`), link home | public | |
| `app/global-error.tsx` | client boundary | own `<html lang>`/`<body>`, imports `globals.css` and fonts | public | |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Root layout | `<html lang>` | `env.STORE_LOCALE` (default `en`) |
| Root layout | page title and title template | `brand.name` (`brand.ts`) |
| Root layout | provider locale and currency | `env.STORE_LOCALE`, `env.STORE_CURRENCY`, passed as two plain props (never the whole `env`) |
| `global-error` | `<html lang>` | the literal `"en"`: it is a client boundary that replaces the root layout, so it cannot read server env (decided here; see Follow-up) |
| Wordmark | text | `brand.name` |
| Footer | `© <year>` | current year computed at render in `env.STORE_TIMEZONE` |
| Footer | store name | `brand.name` |
| Footer | contact email | `brand.contactEmail` (hidden when `null`) |
| Footer | links | `footerLinks` prop (empty until feature 16) |
| Header | nav links | `storeNavItems` (empty until a feature adds one) |
| Header | actions (search, account, cart) | `actions` prop, filled by features 13, 12, 6 |
| Admin sidebar | items | `nav` prop; real routes pass `adminNavItems` |
| Admin sidebar | current item | `usePathname()`: the item whose `href` equals it or is a prefix followed by `/` |
| `Price` | formatted string | `cents` prop; `currency` prop else provider currency (`STORE_CURRENCY`); provider locale (`STORE_LOCALE`) |
| `formatMoney` | fraction digits | `Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits`, then `cents / 10 ** digits` |
| Style guide gate | shown or 404 | `env.VERCEL_ENV` (set by Vercel; unset locally) |
| Product image box | ratio | `--aspect-product` token |
| Sticky header offset | `scroll-padding-top` | `--header-height` token (per breakpoint) |
| Design lint | store name to search for | `brand.name`, imported by the test |
| Empty image | picture | `/placeholder.svg`, `alt=""` (decorative; the product name is in the text beside it) |
| Error pages | copy | static text in each component |

**Key invariants**:
- Components use semantic tokens only (`bg-primary`, `text-muted-foreground`), never raw palette classes, outside `src/lib/brand/` and `src/components/ui/` (checked by the design lint test).
- The store name appears only in `brand.ts`; everything else reads `brand.name`.
- Money is formatted only through `formatMoney` / `Price`; nothing divides cents by 100 by hand (JPY has no minor unit).
- Every Dialog and Sheet has a Title (visually hidden if needed); every icon only button has an `aria-label`.
- Every page has exactly one `h1` and one `main`.
- Light only: no `.dark` tokens and no `dark:` classes until a dark mode spec exists.
- `src/components/` never imports from `src/features/`; features import shells and components from `src/components/`.

**Security model**: this feature handles no user data and no secrets. `/style-guide` is closed in production (404) and `noindex` elsewhere, so demo content never reaches search engines or shoppers. Only `STORE_LOCALE` and `STORE_CURRENCY` cross to the client (neither is secret); the full `env` object never does. `AdminShell` is a layout only: it grants nothing. When feature 5 mounts it under `/admin`, every admin page and action still calls `requireAdmin()` itself. `global-error` never renders `error.message` or a stack (they may hold internals); it may show `error.digest` as a reference code.

**Configuration required**:
- `STORE_LOCALE`: BCP 47 language tag for the store's language and number, price and date formats (for example `en`, `en-GB`, `pl-PL`). Optional, defaults to `en`. Validated with `Intl.NumberFormat.supportedLocalesOf`. Added to `src/lib/env.ts`, `.env.example` and `tests/valid-env.ts`.
- `VERCEL_ENV`: set by Vercel automatically (`production`, `preview`, `development`); optional in the schema, left empty locally. Added to `src/lib/env.ts` and, with that note, to `.env.example`.
- New dev dependencies: `@axe-core/playwright` (a11y scans) and `culori` (parses `oklch()` values and computes WCAG contrast for the token contrast test). New dependencies from the shadcn CLI: `@base-ui/react` (or the package name the CLI installs), `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, and whatever the chosen components pull in.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: open `/` on desktop and phone; header, footer, skip link and main render; axe finds nothing, verifies **AC-6**, **AC-9**
- Happy path: `/style-guide` shows every component in its states and passes axe with a Dialog and the mobile Sheet open, verifies **AC-4**, **AC-9**
- Keyboard: Tab from the top lands on the skip link, Enter moves focus to `main`; open the mobile menu with Enter, Tab stays inside, Escape closes and focus returns to the button; the focused element is never under the sticky header, verifies **AC-6**, **AC-8**
- Contrast: unit test computes each token pair in the table and asserts its target, verifies **AC-3**
- Money: `formatMoney` for EUR, JPY, a negative amount, and a non integer (throws), in `en` and `pl-PL`, verifies **AC-10**
- Config failure: `STORE_LOCALE=xx-invalid-` fails env parsing with a clear message; unset gives `en`, verifies **AC-11**
- Access: with `VERCEL_ENV=production`, `/style-guide` and `/style-guide/admin` return 404, verifies **AC-5**
- Rebrand guard: the design lint test fails on a sample `bg-neutral-900` or literal store name, and passes on the real tree, verifies **AC-12**
- Failure page: a thrown error in a test only route shows the error page with "Try again" and no stack text; an unknown path shows the branded 404, verifies **AC-13**
- Reduced motion: with `reducedMotion: "reduce"` emulated, opening the Sheet shows it with no transition, verifies **AC-15**

## Build plan

Tracer Bullet: the first task threads one real path through every layer (config, tokens, fonts, a component, the shell, the style guide, axe in CI), so each later task only thickens a proven path.

1. **Thin thread**: `pnpm dlx shadcn@latest init` with base `base`, style `vega`, base color `neutral`, icons `lucide` (use the CLI's preset flags per the skill; do not hand build preset codes); set `--radius`, remove the `.dark` block; add `src/lib/brand/brand.ts` and `fonts.ts`, wire fonts and `lang` into `app/layout.tsx`; add `STORE_LOCALE` and `VERCEL_ENV` to the env schema, `.env.example` and `tests/valid-env.ts`; add `button`; build a first `StoreShell` (skip link, header with wordmark, footer) and use it in `app/(store)/layout.tsx`; add `/style-guide` with its production gate showing `Button`; add `@axe-core/playwright`, a shared `expectNoA11yViolations(page)` helper in `tests/e2e/`, the `mobile` Playwright project; in `playwright.config.ts` branch `webServer` on `process.env.CI` (CI: `pnpm build && pnpm start`, no server reuse; locally: `pnpm dev`, reuse); and a new CI e2e step (install Chromium, then `pnpm test:e2e`) with the `tests/valid-env.ts` values exported and `VERCEL_ENV` unset. `app/layout.tsx` reads `env` during `next build`, so the whole schema must be satisfied there. Update `tests/e2e/storefront-home.spec.ts` where the shell changes its assertions. satisfies **AC-1**, **AC-5**, **AC-11**, **AC-16**
2. **Tokens and contrast**: the full token table in `globals.css` (including `--input`, `--muted-foreground`, `--destructive` fixes, `--aspect-product`), `--header-height`, the reduced motion rule, the focus style, `scroll-padding-top`; a Vitest contrast test over the token pairs (using `culori`); the design lint test (name from `brand.name`, whole word, case sensitive). satisfies **AC-3**, **AC-12**, **AC-14**, **AC-15**
3. **Core components**: add the rest of the component set with the shadcn CLI, review each against the skill's rules, and add a style guide section per component showing its states, plus a sample form (`FieldGroup`, `Field`, invalid state) and the placeholder in `aspect-product`. Mount `Toaster` in the root layout. satisfies **AC-4**, **AC-14**
4. **Storefront shell complete**: `storeNavItems`, the mobile Sheet nav (hidden when empty), actions and footer link slots, contact email, copyright year; keyboard tests (skip link, Sheet focus trap and return, focus not obscured) and axe on desktop and phone. satisfies **AC-6**, **AC-8**, **AC-9**
5. **Admin shell**: `AdminShell`, `AdminNavItem`, empty `adminNavItems`, `/style-guide/admin` with demo items and a sample table; axe and keyboard tests including the off canvas sidebar on phone. satisfies **AC-7**, **AC-8**, **AC-9**
6. **Money and locale**: `formatMoney` with unit tests, `StoreFormatProvider` in the root layout, `<Price>`, style guide examples. satisfies **AC-10**, **AC-11**
7. **Error pages**: `not-found`, `error`, `global-error`; e2e for the 404 and the error boundary; axe on the 404. satisfies **AC-9**, **AC-13**
8. **`docs/design.md`**: brand direction, final token table with measured ratios, type, layout, motion, focus, component inventory with usage rules (which component for which job, the shadcn skill's composition rules in brief), and the rebrand checklist (the three files, what each controls, then run `pnpm test` and `pnpm test:e2e`). satisfies **AC-2**, **AC-3**, **AC-12**

## Consequences

**Positive**:
- Every later slice composes pages from ready tokens, components and shells; no slice invents a look or an accessibility pattern.
- A rebrand is three files plus the tests to prove nothing was missed, which is the point of a template.
- axe in CI catches contrast, labeling and landmark regressions on every PR, before a reviewer has to.
- Near black on white with photos carrying the color makes AA contrast easy to keep as the store grows.

**Negative / tradeoffs**:
- Base UI is newer under shadcn than Radix: fewer third party examples, and snippets found online often use Radix's `asChild` where Base UI uses `render`. The shadcn skill's base vs radix rules must be followed.
- Two font families mean two font downloads on the storefront (about 50 to 100KB, self hosted and cached); Newsreader is limited to two weights plus italic to keep it small.
- Light only: adding dark mode later means a second token block, a contrast pass for it, and a theme switch; no component changes, if the "semantic tokens only" rule holds.
- The style guide route is code to maintain: every new shared component should gain a section, or the showcase drifts.
- axe finds about a third to half of WCAG issues; screen reader flow and meaningful alt text still need a human check per feature.
- Adding Playwright to CI makes the pipeline slower (a production build plus a browser run).

**Neutral**:
- `docs/design.md` becomes the visual source of truth; `/sync` should link it from root `AGENTS.md`.
- `next/font/google` downloads the font files at build time (the browser never calls Google), so builds need network access; Vercel and GitHub Actions have it.
- The existing e2e test for `/` changes: the page now sits inside the shell, and the store name in the title comes from `brand.name`.
- Features 5, 6, 12, 13 and 16 fill the shell slots (admin route and user menu, cart action, account action, search, footer links).

## Follow-up

- [ ] `/sync`: add the four newly installed skills (`accessibility`, `playwright-best-practices`, `tailwind-4-docs`, `next-dev-loop`) to root `AGENTS.md` `## Agent skills` (all project wide), link `docs/design.md` from root `AGENTS.md`, add `STORE_LOCALE` and `VERCEL_ENV` to its env notes, note that `migrate-radix-to-base` stays unused (the project starts on Base UI), and add a `## Rules` line: semantic tokens only, store name only from `brand.ts`, money only through `formatMoney`/`Price`.
- [ ] Feature 5 mounts `AdminShell` in `app/admin/layout.tsx` with `adminNavItems` and a user menu (sign out), behind `requireAdmin()`.
- [ ] Feature 6 fills the header cart action and builds the product card on `aspect-product`, `Price` and `placeholder.svg`.
- [ ] Features 7 and 10 need a shared date formatter (`STORE_LOCALE` plus `STORE_TIMEZONE`) for order times; add it to `src/lib/` beside `formatMoney` when first needed.
- [ ] Feature 11 (emails) reuses `brand.ts` and the token values from `docs/design.md` as inline styles (emails cannot use CSS variables reliably).
- [ ] `global-error` uses `"en"` for `lang` because it cannot read server env; if a store runs in another language, pass the locale at build time (`NEXT_PUBLIC_STORE_LOCALE`) in a later change.
- [ ] Dark mode, if wanted later, gets its own spec (tokens, contrast pass, theme switch).
