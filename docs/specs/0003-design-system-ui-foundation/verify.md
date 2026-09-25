# Verify: Design system & UI foundation · spec 0003 · updated 2026-09-25
_Steps derived from spec 0003 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Open `/` on desktop → sticky header with the wordmark (links to `/`), footer with the wordmark and `© <year> <brand name>`, no "Open menu" button (nav list is empty) → AC-6
- [x] On `/`, press Tab once → "Skip to content" is focused and visible; press Enter → focus moves to `<main id="main">` → AC-6, AC-8
- [x] Open `/style-guide` at phone width → "Open menu" button shows; open it with Enter → Sheet titled "Menu" with "Style guide" marked `aria-current="page"`; Tab stays inside; Escape closes and focus returns to the button → AC-6, AC-8
- [x] On `/style-guide`, Tab and Shift+Tab through the page → every focused element shows a 2px outline with 2px offset and never sits under the sticky header → AC-8
- [x] On `/style-guide`, open the Dialog → Tab stays inside, Escape closes, focus returns to "Open dialog" → AC-8
- [x] On `/style-guide`, check every component section shows the states from the spec's states table (Button variants, sizes, disabled, loading; invalid Input, Select, Textarea, Checkbox, Radio; Card full composition; each Badge variant; both Alerts; Dialog, Sheet, Dropdown menu with a disabled item; success and error toasts; Table with rows and with Empty; Skeleton, Spinner, Empty, Separator) → AC-4
- [x] On `/style-guide`, the placeholder sits in a 4:5 box (`aspect-product`) → AC-14
- [x] On `/style-guide/admin` desktop → sidebar with Dashboard marked current, top bar with trigger, wordmark and "Admin" badge, user menu; the trigger collapses the sidebar → AC-7
- [x] On `/style-guide/admin` at phone width → sidebar hidden; the trigger opens it as an off canvas sheet; Escape returns focus → AC-7, AC-8
- [x] `currentHref(nav, "/admin/orders/123")` marks Orders and only Orders, even with a Dashboard at `/admin` (src/components/layout/nav.test.ts) → AC-7
- [x] Visit an unknown path → 404 status, "We can't find that page", link home, store shell around it → AC-13
- [x] Visit `/style-guide/throw` on a production build → "Something went wrong", "Try again", link home, no error message or stack text → AC-13
- [x] With the OS set to reduce motion, open the Sheet and Dialog → they appear with no slide or fade → AC-15
- [x] Check the network panel on `/` → font files come from the app's own origin, no request to fonts.googleapis.com or fonts.gstatic.com → AC-1

## Commands
- [x] `pnpm test` → contrast test passes for every token pair; design lint passes on the real tree and its samples fail as expected; `formatMoney` and env tests pass → AC-3, AC-10, AC-11, AC-12
- [x] `pnpm test:e2e` (and `CI=1 pnpm test:e2e` for the production build path) → 40 passed on desktop and mobile, axe zero violations on `/`, `/style-guide` (Dialog, Select and mobile Sheet open), `/style-guide/admin` and the 404 → AC-8, AC-9, AC-16
- [x] `grep -rn "dark:" app src` → no hits in shipped classes; `grep -n "\.dark" app/globals.css` → no `.dark` token block → AC-1
- [x] `cat components.json` → `style: base-vega`, `baseColor: neutral`, `iconLibrary: lucide`, `cssVariables: true` → AC-1
- [x] Build with `VERCEL_ENV=production` and `pnpm start` → `/style-guide` and `/style-guide/admin` return 404; without it they return 200 with `<meta name="robots" content="noindex, nofollow">` → AC-5
- [x] Start with `STORE_LOCALE=xx-invalid-` → boot fails naming STORE_LOCALE with the BCP 47 hint; unset → `<html lang="en">`; `STORE_LOCALE=pl-PL` → `<html lang="pl-PL">` → AC-11
- [ ] Temporarily change `brand.name` in `src/lib/brand/brand.ts` → `pnpm test` still passes and the title, wordmark and footer all show the new name → AC-12
- [x] Open `docs/design.md` → covers brand direction, every color token with its measured ratio, type scale, spacing and layout, radius, image ratio, motion, focus, component inventory with usage rules, rebrand checklist → AC-2, AC-3
- [ ] Check the CI run on the PR → the new Playwright step builds and runs against `pnpm start` with `VERCEL_ENV` unset → AC-16

## Value sourcing
- [x] `<html lang>` follows `STORE_LOCALE` (try `en-GB`) → lang changes, default `en` when unset
- [x] Page titles use `brand.name`: `/style-guide` title is `Style guide · <brand name>`
- [x] Provider locale and currency: set `STORE_CURRENCY=PLN STORE_LOCALE=pl-PL` → `/style-guide` Money section shows `19,99 zł` for the store currency row; only these two values appear in the client payload, never other env values (search the page source for `CART_COOKIE_SECRET` → none)
- [ ] `global-error` uses `lang="en"` regardless of `STORE_LOCALE` (known, see spec follow up)
- [ ] Footer year uses `STORE_TIMEZONE`: with `STORE_TIMEZONE=Pacific/Kiritimati` near New Year UTC, the year matches Kiritimati, not UTC (unit check of the formatter if a clock mock is easier)
- [ ] Contact email: set `brand.contactEmail` to an address → footer shows a mailto link; `null` → hidden
- [x] Footer links and header actions come only from the `footerLinks` and `actions` props (style guide passes demo ones; `/` shows none)
- [x] Header nav comes from `storeNavItems` (empty on `/`); admin sidebar items come from the `nav` prop
- [x] `Price` with `currency="JPY"` shows `¥1,999` for 1999 while the store currency is EUR
- [x] `formatMoney` fraction digits come from Intl: JPY 0, EUR 2, KWD 3 (money.test.ts)
- [x] Style guide gate reads `VERCEL_ENV`, not `NODE_ENV`: `pnpm build && pnpm start` locally (NODE_ENV production) still serves `/style-guide`
- [ ] Product box ratio comes from `--aspect-product`: change it to `1 / 1` and the placeholder box turns square
- [x] Sticky header offset: `scroll-padding-top` equals `--header-height` (3.5rem below md, 4rem from md)
- [x] Design lint reads the name from `brand.name` at run time (change the name and a file with the old literal stops failing)
- [x] Empty image: `/placeholder.svg` with `alt=""`

## Acceptance-criteria coverage
- AC-1 … network panel step, `dark:` grep, components.json step · AC-2 … design.md step · AC-3 … `pnpm test`, design.md step · AC-4 … component states step · AC-5 … VERCEL_ENV build step (also `app/style-guide/layout.test.ts`) · AC-6 … home shell, skip link, mobile menu steps · AC-7 … admin desktop and phone steps · AC-8 … keyboard steps, `pnpm test:e2e` · AC-9 … `pnpm test:e2e` · AC-10 … `pnpm test`, Price steps · AC-11 … STORE_LOCALE step · AC-12 … brand.name step, `pnpm test` · AC-13 … 404 and error page steps · AC-14 … placeholder step · AC-15 … reduced motion step · AC-16 … CI step
