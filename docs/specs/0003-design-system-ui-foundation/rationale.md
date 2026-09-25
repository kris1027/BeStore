# 0003. Design system and UI foundation: rationale

The decision record behind [index.md](index.md). `/develop` builds from `index.md` and can skip this file.

## Context

BeStore has a stack (spec 0001: Tailwind CSS 4 plus shadcn/ui) and a schema (spec 0002), but no visual language at all: no tokens, no components, no page shell, and no `design.md`. `app/globals.css` only imports Tailwind, and `src/components/ui/` is empty. Slice 1 (admin sign in, core buy loop, card payment) is next, and it builds real pages on both the storefront and the admin. Without a shared foundation, each slice invents its own spacing, colors, focus styles and form patterns, and the two halves of the app drift apart within a few features.

BeStore is a template, not one brand. It has no product range, no logo and no brand colors yet. So the look must be neutral enough to fit any product, and everything that makes it a specific brand (name, fonts, colors) must be easy to find and change without touching feature code.

The project rules set WCAG AA as the baseline on both storefront and admin: labels, keyboard use, visible focus and contrast. Accessibility retrofitted after ten features means auditing every page; built into the base components and checked automatically, it mostly holds by itself. The same goes for formatting money: prices are stored as integer minor units, and the store's currency and locale are deploy settings, so every page that shows a price needs one correct way to turn cents into text.

The team is small, and the stack is already fixed. The forces are: ship Slice 1 soon, keep the operational load at zero (no extra services or build pipelines), keep a rebrand cheap, and make AA the default rather than a review finding.

## Options considered

### Option 1: shadcn/ui on Base UI with CSS tokens, one shared theme, and a style guide route checked by axe

Initialize shadcn with Base UI primitives and the Vega style, define one light theme as CSS variables, keep brand identity in `src/lib/brand/` and the token block, ship both shells and a core component set, and prove it all on a `/style-guide` route that Playwright and axe scan in CI.

**Pros**:
- Uses exactly the stack spec 0001 already chose; no new tool beyond axe.
- The style guide is a normal Next.js page, so it renders with the real fonts, tokens and server components, and the same e2e setup tests it.
- One theme for both halves keeps the app coherent and halves the contrast work.

**Cons**:
- A showcase page is weaker than a component workshop: no isolated stories, no per component controls.
- Base UI under shadcn has fewer examples online than Radix.

### Option 2: Storybook as the design system workshop

Same components and tokens, but documented and tested in Storybook stories with its accessibility addon, instead of a route in the app.

**Pros**:
- Industry standard: isolated stories, controls, docs pages, and an a11y panel per component.
- Designers and reviewers can browse components without running the store.

**Cons**:
- A second build to keep working with Next.js 16, React 19 and Tailwind 4, which usually lags the framework.
- Server components and `next/font` need mocks or workarounds in Storybook, so stories drift from what the app actually renders.
- More CI time and more config for a small team.

### Option 3: A token pipeline (design tokens in JSON, generated into CSS)

Keep tokens in a JSON file (for example via Style Dictionary), generate the CSS variables and a TypeScript map, and share the same source with emails.

**Pros**:
- One token source for the web app, emails and any future native app.
- Tokens become data, easy to swap per brand or export to a design tool.

**Cons**:
- A generator step and a build dependency for about twenty values that Tailwind 4 already reads straight from CSS.
- Solves a multi platform problem the project does not have.

### Option 4: Separate storefront and admin themes

Give the storefront an editorial theme and the admin a denser, utility theme, each with its own tokens.

**Pros**:
- Each side is tuned for its job: roomy product pages, compact data tables.

**Cons**:
- Two token sets to keep at AA, two sets of screenshots in the style guide, and two things to change in a rebrand.
- Vega's default density already works for admin tables, so the gain is small.

## Rationale

Option 1 fits the forces best. The stack is decided, and the cheapest foundation is the one that adds almost nothing to it: CSS variables that Tailwind 4 and shadcn read directly, components copied into the repo, and a page in the app itself as the showcase. Storybook (Option 2) is the usual answer for a design system, but its value (isolated stories, a browsable catalog for non developers) matters most for large teams and many consumers. Here it costs a second build that fights server components and `next/font`, for a team that already has a Playwright suite that can scan a real page. A token pipeline (Option 3) solves sharing tokens across platforms; BeStore has one web app and emails, and the emails can take a handful of values from `docs/design.md` by hand.

The template nature of the project drove the rebrand design. Everything brand specific sits in `src/lib/brand/` and the token block, and a Vitest check rejects raw palette classes and the literal store name elsewhere, so a rebrand cannot silently miss a hard coded value. Fonts sit apart from `brand.ts` because `next/font` cannot run inside React Email, and emails (feature 11) will want the store name. The engineer asked for two files; the honest count is three, and the split keeps the brand constants reusable.

Accessibility is built in at three levels. The tokens are measured, and two shadcn neutral defaults are corrected because they fail AA in real use: muted text on a muted surface (4.34:1) and form control borders (about 1.2:1, below the 3:1 that WCAG 1.4.11 asks for controls). Base UI supplies focus management, keyboard behavior and ARIA wiring in the primitives. And axe runs on every PR against the style guide, both shells and the 404 page, on desktop and phone, so regressions are caught by CI, not by a shopper. axe cannot judge everything (reading order that makes sense, useful alt text), so the keyboard tests and a human pass per feature still matter.

Base UI was chosen over Radix because shadcn now treats it as its default and it is actively maintained, and a fresh project has nothing to migrate. The cost is that many snippets online use Radix APIs (`asChild` in place of `render`); the installed shadcn skill documents the differences. Light only mode, one accent free palette and a single theme were chosen for the same reason: each keeps the first slices small, and the semantic tokens rule keeps dark mode or an accent color a token change later, not a component rewrite.

### Contrast notes (starting values, to be measured at build)

Relative luminance of a neutral OKLCH gray is about L cubed, so:

| Pair | Approx. ratio | Result |
|---|---|---|
| `--foreground` 0.145 on white | 20:1 | pass |
| `--muted-foreground` 0.556 (shadcn default) on white | 4.7:1 | pass |
| `--muted-foreground` 0.556 on `--muted` 0.97 | 4.3:1 | fails AA text |
| `--muted-foreground` 0.5 on white / on `--muted` | 6.0:1 / 5.5:1 | pass |
| `--input` 0.922 (shadcn default) on white | 1.2:1 | fails 1.4.11 |
| `--input` 0.62 on white | 3.6:1 | pass |
| `--ring` 0.205 on white | 18:1 | pass |
| `--primary-foreground` 0.985 on `--primary` 0.205 | 17:1 | pass |

The destructive red is set darker than the shadcn default so it passes as text on white and behind white text; its exact ratio is measured at build, since chroma shifts luminance.
