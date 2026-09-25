# BeStore design system

**Source**: spec [0003](specs/0003-design-system-ui-foundation/index.md) · **Tokens live in**: [app/globals.css](../app/globals.css) (the `:root` block) · **Showcase**: `/style-guide` and `/style-guide/admin` (local dev and Vercel previews, 404 in production)

This file is the visual source of truth for the storefront and the admin panel. Token values live in CSS, not here; the tables below mirror them so you can read the system without opening the stylesheet. When the two disagree, the CSS wins and this file needs a fix.

## Character

Minimal and editorial. Lots of white space, near black type on white, a serif for storefront headings, and nothing decorative competing with the product photos. Photos carry the color; the interface stays quiet. BeStore is a template, so nothing assumes a product type.

## Build mandate

- Compose pages from the tokens, the components in `src/components/ui/` and the two shells. If you feel the need to invent a look, add it to the system first (a token, a component, a style guide section).
- Semantic tokens only (`bg-primary`, `text-muted-foreground`, `border-input`). Never a raw palette class (`bg-neutral-900`, `text-red-600`, `bg-white`) outside `src/lib/brand/` and `src/components/ui/`. The design lint test ([src/lib/design/lint.test.ts](../src/lib/design/lint.test.ts)) fails the build if you do.
- The store name comes from `brand.name` only. The same test fails on the literal name anywhere else.
- Light only. No `.dark` tokens and no `dark:` classes until a dark mode spec exists.
- Money is shown only through `formatMoney` or `<Price>`. Never divide cents by 100 by hand (JPY has no minor unit).
- WCAG 2.2 AA on every page: labels, keyboard use, visible focus, contrast. axe runs on every PR.

## Color

Every token is OKLCH, neutral gray (chroma 0) except `--destructive`. `--border` is for decorative dividers only; anything a user must see to operate (input borders, checkbox and radio outlines) uses `--input`.

| Token | Value | Use |
|---|---|---|
| `--background`, `--card`, `--popover` | `oklch(1 0 0)` | page and surfaces |
| `--foreground`, `--card-foreground`, `--popover-foreground` | `oklch(0.145 0 0)` | body text |
| `--primary`, `--ring` | `oklch(0.205 0 0)` | primary buttons, active states, focus outline |
| `--primary-foreground` | `oklch(0.985 0 0)` | text on primary |
| `--secondary`, `--muted`, `--accent` | `oklch(0.97 0 0)` | quiet fills, hover |
| `--secondary-foreground`, `--accent-foreground` | `oklch(0.205 0 0)` | text on quiet fills |
| `--muted-foreground` | `oklch(0.5 0 0)` | secondary text (darker than the shadcn default 0.556, which fails on `--muted`) |
| `--destructive` | `oklch(0.48 0.213 27.518)` | errors and destructive actions (darker than the spec's starting 0.505, so the hover tint passes) |
| `--border` | `oklch(0.922 0 0)` | decorative dividers only |
| `--input` | `oklch(0.62 0 0)` | form control borders, checkbox, radio |
| `--sidebar` | `oklch(0.985 0 0)` | admin sidebar surface |
| `--sidebar-*` | shadcn neutral defaults, `--sidebar-ring` = `--ring` | admin sidebar |
| `--chart-1` to `--chart-5` | grays 0.87 to 0.269 | reserved for the sales dashboard (feature 15) |

### Measured contrast

Measured from the stylesheet by [src/lib/design/contrast.test.ts](../src/lib/design/contrast.test.ts), which fails if any pair drops below its minimum. Translucent layers are blended the way the browser paints them. `/style-guide` shows the same table, computed at build time.

| Pair | Foreground | Background | Ratio | Needs |
|---|---|---|---|---|
| Body text | `--foreground` | `--background` | 19.79:1 | 4.5:1 |
| Body text on muted | `--foreground` | `--muted` | 18.15:1 | 4.5:1 |
| Card text | `--card-foreground` | `--card` | 19.79:1 | 4.5:1 |
| Popover text | `--popover-foreground` | `--popover` | 19.79:1 | 4.5:1 |
| Primary button | `--primary-foreground` | `--primary` | 17.16:1 | 4.5:1 |
| Primary button, hover | `--primary-foreground` | `--primary` at 80% over `--background` | 9.12:1 | 4.5:1 |
| Secondary fill | `--secondary-foreground` | `--secondary` | 16.42:1 | 4.5:1 |
| Accent fill (hover, menus) | `--accent-foreground` | `--accent` | 16.42:1 | 4.5:1 |
| Secondary text | `--muted-foreground` | `--background` | 6.00:1 | 4.5:1 |
| Secondary text on muted | `--muted-foreground` | `--muted` | 5.50:1 | 4.5:1 |
| Secondary text in the sidebar | `--muted-foreground` | `--sidebar` | 5.75:1 | 4.5:1 |
| Error text | `--destructive` | `--background` | 7.32:1 | 4.5:1 |
| Destructive button and badge | `--destructive` | `--destructive` at 10% over `--background` | 5.95:1 | 4.5:1 |
| Destructive button, hover | `--destructive` | `--destructive` at 20% over `--background` | 4.78:1 | 4.5:1 |
| Destructive alert description | `--destructive` at 90% | `--card` | 6.50:1 | 4.5:1 |
| White text on destructive | `--background` | `--destructive` | 7.32:1 | 4.5:1 |
| Sidebar text | `--sidebar-foreground` | `--sidebar` | 18.96:1 | 4.5:1 |
| Sidebar group label | `--sidebar-foreground` at 70% | `--sidebar` | 7.48:1 | 4.5:1 |
| Sidebar active item | `--sidebar-accent-foreground` | `--sidebar-accent` | 16.42:1 | 4.5:1 |
| Sidebar primary | `--sidebar-primary-foreground` | `--sidebar-primary` | 17.16:1 | 4.5:1 |
| Form control border | `--input` | `--background` | 3.64:1 | 3:1 |
| Focus ring | `--ring` | `--background` | 17.91:1 | 3:1 |
| Focus ring in the sidebar | `--sidebar-ring` | `--sidebar` | 17.16:1 | 3:1 |

If you add a new text or control color pair, add it to `contrastPairs` in [src/lib/design/contrast.ts](../src/lib/design/contrast.ts) so it is measured too. Never convey meaning by color alone: a status badge carries its word, an invalid field carries its error text.

## Typography

- **Newsreader** (`font-heading`, weights 400 and 500 plus italic): storefront h1 to h3 and the wordmark.
- **Inter** (`font-sans`, variable): body text, controls, and all admin text. Inside `AdminShell`, `--font-heading` points at Inter, so shadcn titles follow without overrides.
- Both load through `next/font` in [src/lib/brand/fonts.ts](../src/lib/brand/fonts.ts), self hosted (the browser never calls Google), `display: swap`.

| Role | Classes |
|---|---|
| Storefront h1 | `font-heading text-4xl md:text-5xl` |
| Storefront h2 | `font-heading text-3xl` |
| Storefront h3 | `font-heading text-2xl` |
| Admin page title | `font-sans text-2xl font-semibold` |
| Body | `text-base` (16px minimum, line height 1.5) |
| Small, secondary | `text-sm`, `text-sm text-muted-foreground` |

One `h1` per page, and headings never skip a level.

## Spacing and layout

- Mobile first, Tailwind's default breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280.
- Storefront container: `storeContainer` from [src/components/layout/container.ts](../src/components/layout/container.ts) (`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8`).
- Tailwind's 4px grid. Vertical rhythm between page sections `py-12 md:py-16`.
- Layout with `flex` or `grid` plus `gap-*`. Never `space-x-*` or `space-y-*`.
- `--header-height` is 3.5rem below `md` and 4rem from `md`. `html` uses it as `scroll-padding-top`, so focused elements and anchor targets never land under the sticky header (WCAG 2.4.11).

## Radius

`--radius` is `0.25rem`. shadcn derives `rounded-sm` to `rounded-4xl` from it, so a rebrand changes one value.

## Product images

- Ratio 4:5 through the `aspect-product` utility (the `--aspect-product` token).
- No image yet: `/placeholder.svg`, a neutral 4:5 picture with no text, with `alt=""` because the product name sits beside it.

## Motion

Short and quiet: only the shadcn defaults from `tw-animate-css`, around 100 to 200ms (the toast stack slides a little longer). With `prefers-reduced-motion: reduce`, a global rule sets every animation and transition to 0.01ms, not 0, because Base UI waits for the end events before it unmounts a closed Sheet, Dialog or toast.

## Focus

`:focus-visible` only (never on mouse click): a 2px solid `--ring` outline with a 2px offset on every interactive element, links in prose included. The rule is unlayered in `globals.css` so it beats the `outline-none` and `focus-visible:ring-*` utilities inside the shadcn components, and it clears their ring so there is one indicator, not two. Never remove an outline without a replacement.

## Touch targets

At least 44 by 44px for storefront controls: header actions, the menu button, primary buttons on phones (`size-11` on icon buttons, `h-11` on primary buttons). The admin keeps the Vega sizes, which stay above the 24px AA minimum (WCAG 2.5.8).

## Components

shadcn/ui, style Vega, on Base UI, installed in `src/components/ui/` with the shadcn CLI. Base UI uses `render` where Radix uses `asChild`; snippets found online often use the Radix form. After any `shadcn add`, review the files: strip `dark:` classes, and check the rules below.

| Need | Use | Rules |
|---|---|---|
| An action | `Button` | One primary per view. Variants before custom styles. Loading is `Spinner` with `data-icon` plus `disabled`, never an `isLoading` prop. Icons use `data-icon="inline-start"` or `"inline-end"` and no size classes. Icon only buttons need an `aria-label`. |
| A link that looks like a button | `<Link className={buttonVariants(...)}>` | Keeps link semantics. |
| A form | `FieldGroup` plus `Field`, `FieldLabel`, `FieldDescription`, `FieldError` | Invalid: `data-invalid` on `Field`, `aria-invalid` on the control, error tied with `aria-describedby`. Disabled: `data-disabled` on `Field`, `disabled` on the control. Wire to React Hook Form and Zod when a feature adds a form. |
| Text entry | `Input`, `Textarea` | Always a visible label; a placeholder is never the only label. |
| Pick one from a list | `Select` | Items inside `SelectGroup`; pass `items` so the value shows its label. |
| Related checkboxes or radios | `FieldSet` plus `FieldLegend`, `Checkbox`, `RadioGroup` | Each control has its own `FieldLabel`. |
| One grouped object | `Card` | Full composition: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`. |
| A short status | `Badge` | The word carries the meaning, not the color. |
| A callout that stays | `Alert` | `destructive` for errors the user must act on. |
| A passing confirmation | `toast.add({ title, description, type })` from `@/components/ui/toast` | The Base UI toast, not Sonner. `Toaster` is mounted in the root layout. |
| A modal decision | `Dialog` | Always a `DialogTitle` (`sr-only` if hidden). Focus trap, Escape and focus return come built in. |
| A side panel (cart, mobile nav) | `Sheet` | Always a `SheetTitle`. |
| A menu of actions | `DropdownMenu` | Items inside `DropdownMenuGroup`. |
| Tabular data | `Table` | Real `TableHead` cells and a caption (`sr-only` if needed). Let cells wrap, or make a wide table's scroll box keyboard focusable, since axe flags a scroll region you cannot reach by keyboard. |
| Nothing here yet | `Empty` | Say why and what to do next. |
| Content loading | `Skeleton` | Hide it from screen readers (`aria-hidden`). |
| A running action | `Spinner` | Announces "Loading". |
| A divider | `Separator` | Never `<hr>` or a bordered `div`. |
| Admin navigation | `Sidebar` (inside `AdminShell`) | Collapses on desktop, off canvas sheet below `md`. |

### Shells

- **`StoreShell`** ([src/components/layout/store-shell.tsx](../src/components/layout/store-shell.tsx)), used by `app/(store)/layout.tsx`: skip link (first tab stop, to `<main id="main">`), sticky header (wordmark left, nav middle, `actions` right), footer (wordmark, `© <year> <brand name>` in `STORE_TIMEZONE`, `footerLinks`, contact email when `brand.contactEmail` is set). Header links come from `storeNavItems` in [store-nav.ts](../src/components/layout/store-nav.ts); below `md` they move into a Sheet behind an "Open menu" button, which is hidden while the list is empty.
- **`AdminShell`** ([src/components/layout/admin-shell.tsx](../src/components/layout/admin-shell.tsx)): sidebar from the `nav` prop (the most specific matching item gets `aria-current="page"`), a top bar with the sidebar trigger, the wordmark with an "Admin" badge, and a `userMenu` slot. It is a layout only and grants nothing: every admin page and action still calls `requireAdmin()`. Real routes pass `adminNavItems` from [admin-nav.ts](../src/components/layout/admin-nav.ts); each admin feature appends its own entry.

### Shared app components

- `Wordmark`: `brand.name` in the heading font, a link home.
- `Price` (`cents`, optional `currency`): formats with the store locale and currency from `StoreFormatProvider` (mounted in the root layout). Orders pass their own `currency`.
- `StatusPage`: the body of the 404 and error pages (one `h1`, a plain message, a way out).

## Rebrand checklist

A rebrand touches three places and nothing else:

1. [src/lib/brand/brand.ts](../src/lib/brand/brand.ts): the store name and contact email. Emails (feature 11) read it too.
2. [src/lib/brand/fonts.ts](../src/lib/brand/fonts.ts): the heading and body fonts (keep the `--font-heading` and `--font-sans` variable names).
3. The `:root` token block in [app/globals.css](../app/globals.css): colors, `--radius`, `--aspect-product`, `--header-height`.

Then run `pnpm test` (contrast and design lint) and `pnpm test:e2e` (axe and keyboard), fix anything they flag, and update the tables in this file. `global-error` sets `lang="en"` as a literal, so a store in another language also needs that line (see the spec's follow up).
