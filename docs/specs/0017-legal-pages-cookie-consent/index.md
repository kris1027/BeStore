# 0017. Legal pages and cookie consent

**Date**: 2026-10-20
**Status**: Accepted

## Summary

The storefront gets five legal pages (terms, privacy, returns, shipping, cookies) written as Markdown files in the repo, linked from every store footer and from checkout. Checkout gains a required "I accept the terms" checkbox, and each new order records which terms version (the terms file's date) the customer accepted and when, shown to admins and in the order confirmation email. A small first party consent system (a cookie holding the customer's choice, a banner, a settings dialog and a gate component) is built now for feature 18 to plug analytics into; the banner stays hidden until a cookie that needs consent actually exists. One small migration adds two nullable columns to `orders`; nothing else touches the database.

## Requirements

**User stories**:
- As a customer, I want to read the terms, privacy, returns, shipping and cookie rules before I buy, so I know what I'm agreeing to and how to send something back.
- As a customer, I want to accept the terms at checkout and get a record of which version applied, so a later dispute is about the text I actually saw.
- As a customer, I want to refuse optional cookies as easily as I accept them, and change my mind later, so the store tracks me only if I say yes.
- As an admin, I want each order to show the terms version the customer accepted, so I handle a dispute against the right text.
- As the developer of feature 18, I want one small API that tells me whether analytics or marketing is allowed, so I never load a tracking script without consent.

**Acceptance criteria** (the contract):

Legal pages

- **AC-1**: `/terms`, `/privacy`, `/returns`, `/shipping` and `/cookies` render inside the store shell. Each shows its title as the only `h1`, a "Last updated <date>" line, and its body from `src/lib/legal/content/<slug>.md`. The date is the file's front matter `updated` (a `YYYY-MM-DD` calendar date), formatted as a long date in `STORE_LOCALE` with `timeZone: "UTC"`, so it never shifts by a day. Every page except `/shipping` is fully static; `/shipping` is static plus the cached settings read (AC-5). None reads cookies or other request data.
- **AC-2**: Each page sets `title` (the front matter `title`), `description` (the front matter `description`) and `alternates.canonical` (`NEXT_PUBLIC_SITE_URL` plus the path). The pages are indexable: no `noindex`, no `X-Robots-Tag`.
- **AC-3**: Every page that renders `StoreShell` (the store layout, `app/not-found.tsx`, the style guide) lists, in its footer nav, links to Terms of sale, Privacy policy, Returns, Shipping and Cookie policy (in that order), then a "Cookie settings" control (AC-16). The admin panel shows none of them. In print, the store header, the footer and the consent banner are hidden (`print:hidden`), so printing a legal page prints only its text.
- **AC-4**: The Markdown may use placeholders `{{name}}`. The seller placeholders (`{{seller.name}}`, `{{seller.address}}`, `{{seller.taxId}}`, `{{seller.registration}}`, `{{seller.email}}`, `{{seller.phone}}`) are filled from `brand.legal` in `src/lib/brand/brand.ts`; the store ones (`{{store.country}}`, `{{store.currency}}`) from `STORE_COUNTRY` (its display name in `STORE_LOCALE`) and `STORE_CURRENCY`; the shipping ones from AC-5. A placeholder with no known value throws when the module loads, so the build and `pnpm test` fail rather than ship `{{…}}` text. Drafts mark every store specific blank as `[[TO FILL: what goes here]]`; a `brand.legal` field still `null`, or any `[[TO FILL` left in a legal file, makes the loader throw when `VERCEL_ENV` is `production` (other environments render the marker as is, so the drafts stay reviewable).
- **AC-5**: `/shipping` fills `{{deliveryFee}}` with the flat fee and `{{freeDeliveryRule}}` with "Delivery is free on orders of <threshold> or more." when a threshold is set, or "The same fee applies to every order." when it is not. Both come from `getShippingSettings()` (the existing cached read tagged `storeSettingsTag`), formatted in `STORE_CURRENCY` and `STORE_LOCALE`. Saving new values in `/admin/settings` changes the page on its next load with no deploy, because that save already expires the tag.
- **AC-6**: `/returns` covers the 14 day right of withdrawal and how to use it, and ends with a "Model withdrawal form" section holding the EU model form text, the seller's name, address and email filled in from AC-4, and a line saying it can be printed or copied into an email to `{{seller.email}}`.
- **AC-7**: Each draft covers at least the sections listed under *Content outline* below, in plain language, with a note at the top of each file (an HTML comment, not rendered) saying it is a draft that needs legal review before launch.

Checkout and accounts

- **AC-8**: The `/checkout` form shows an unticked checkbox above Pay, labelled "I accept the [terms of sale] and have read the [privacy policy]." Both links open in a new tab and say so in their accessible name ("terms of sale, opens in a new tab"), so the typed form survives. Under the Pay button, next to the existing Stripe line, one line links Returns and Shipping the same way. Pay with the box unticked shows "Tick the box to accept the terms of sale." under it, moves focus to it, and sends nothing to the server. The Pay button is never disabled because of the box.
- **AC-9**: `startCheckout` takes two new inputs: `acceptTerms` (must be `true`) and `termsVersion` (a `YYYY-MM-DD` string, the version the page showed). A missing or false `acceptTerms` returns `validation` with the AC-8 message on the `acceptTerms` field. A `termsVersion` that is not the current terms `updated` returns the new error `{ code: "terms_changed", currentVersion }`; so does a missing or malformed one, since the customer never saw the current text (it is not a field they type, so `validation` would have nothing to point at). Both checks run before any database work, so a refusal creates no order and takes no lock.
- **AC-10**: On `terms_changed` the form unticks the box, switches its hidden version to `currentVersion`, shows "Our terms of sale changed on <date>. Please read them and tick the box again." with a link to `/terms` (new tab), above the box in an alert, and moves focus to the box. Every other field keeps its value. The next Pay with the box ticked succeeds.
- **AC-11**: A successful `startCheckout` writes `terms_version` (the accepted version) and `terms_accepted_at` (the server time at Pay) on the new order, in the same transaction that creates it. A database CHECK makes the two columns either both null or both set. Orders created before this feature keep both null. The PII purge (spec 0008) leaves both columns alone.
- **AC-12**: `/account/sign-up` shows, under the submit button, "By creating an account you accept the [terms of sale] and confirm you have read the [privacy policy]." Both links open in a new tab, as in AC-8. Nothing new is stored.
- **AC-13**: `/admin/orders/[id]` shows "Terms accepted: version <long date>, on <date and time>" (the version as in AC-1, the time in `STORE_TIMEZONE`), or "Terms accepted: not recorded" when both columns are null.
- **AC-14**: The order confirmation email (spec 0011) gains, above its footer, the line "Terms of sale version <long date> applied to this order." and links to Terms of sale, Returns and Privacy policy (absolute URLs from `NEXT_PUBLIC_SITE_URL`). An order without a recorded version (paid before this feature) omits the version line and keeps the links. The template still never reads env (spec 0011, AC-18): both arrive as props.

Cookie consent

- **AC-15**: The choice lives in one first party cookie `bestore_consent`, written only by the browser (`document.cookie`, not `httpOnly`), `path=/`, `SameSite=Lax`, `Secure` when `location.protocol` is `https:`, `max-age` 12 months. Its value is URL encoded JSON `{"v":"<cookie policy updated>","at":<epoch ms>,"analytics":<bool>,"marketing":<bool>}`. A missing cookie, a value that fails the Zod schema, a `v` different from the current `/cookies` front matter `updated`, or an `at` older than 12 months all count as "no choice yet". The cookie is itself necessary (it records a choice) and is listed as such.
- **AC-16**: The "Cookie settings" footer control is a link to `/cookies` in the server HTML; after hydration it becomes a button that opens the settings dialog instead. `/cookies` also shows a "Cookie settings" button (after hydration) that opens the same dialog. The dialog lists Necessary (checked and disabled, "Always on"), Analytics and Marketing, each with a one line purpose, and has three buttons: Save choices, Accept all, Reject all. A category with no entry in the registry (AC-17) shows "Not used right now" and its checkbox is disabled and unticked. Saving writes the AC-15 cookie and closes the dialog.
- **AC-17**: `src/lib/consent/registry.ts` lists every cookie the store sets, with name (or a name pattern), category (`necessary`, `analytics`, `marketing`), purpose, lifetime and who sets it. It ships with the necessary ones only: `bestore_cart`, `bestore_consent`, the Supabase auth cookies (`sb-<ref>-auth-token` and its numbered chunks) a line for Stripe's own cookies on its hosted payment page (set on Stripe's domain, not ours) and `sidebar_state` (the admin panel's sidebar, staff only). `/cookies` renders the registry as a table after its Markdown body.
- **AC-18**: The banner shows on storefront pages only, and only when all three hold: the registry has at least one `analytics` or `marketing` entry, there is no valid choice (AC-15), and the browser does not send Global Privacy Control (AC-21). With today's registry it never shows. It mounts after hydration, so the server HTML never contains it and a returning visitor never sees it flash.
- **AC-19**: The banner is a bar fixed to the bottom of the viewport that does not block the page and takes no focus. It is a `section` with `aria-label="Cookie consent"`, placed in the DOM right after the skip link so keyboard and screen reader users reach it early. It holds one or two sentences naming what optional cookies are for, a link to the cookie policy, and three buttons of the same size and style: Accept all, Reject all, Choose cookies (which opens the AC-16 dialog). While it shows, the page gets a bottom scroll padding equal to its height, so a focused element is never hidden behind it (WCAG 2.4.11). Accept all and Reject all write the cookie and hide the banner.
- **AC-20**: When a saved choice turns a category from on to off, the browser deletes every cookie the registry lists for that category (matching each registry name or pattern against the names currently in `document.cookie`, deleted on `path=/` for the host only, since the store sets no `Domain` attribute), writes the new choice, then reloads the page, so a script already running stops. Turning a category on needs no reload.
- **AC-21**: When `navigator.globalPrivacyControl === true` and there is no valid choice, analytics and marketing count as refused, the banner does not show and nothing is written. The customer can still opt in from Cookie settings; that saved choice then wins over the signal.
- **AC-22**: `src/lib/consent/` exports, for feature 18: `ConsentProvider` (mounted once in the store layout, taking the cookie policy version and the registry as props), `useConsent()` returning `{ ready, analytics, marketing, openSettings }`, and `<ConsentGate category="analytics" | "marketing">` which renders its children only when `ready` and the category is granted. Before mount `ready` is false and every gate renders nothing.
- **AC-23**: On a first visit to the home page, a product page, `/cart` and `/checkout` (no consent cookie set), the browser holds no cookie outside the registry's `necessary` entries (checked with JavaScript on and off), and `localStorage` and `sessionStorage` hold no keys (checked with JavaScript on, the only case where a script could write them).
- **AC-24**: `/style-guide` (non production only, as today) gets a Consent section that renders the provider, banner and dialog with a demo registry holding one analytics cookie, so the banner, the three buttons, the dialog and the withdrawal reload can be exercised end to end. The demo cookie name starts with `demo_` and is set by the demo only.

**Content outline** (what each draft must cover; `/develop` writes the text, a lawyer reviews it):
- **Terms of sale** (`/terms`): who the seller is (AC-4 placeholders); scope and how to contact; accounts (optional, how to delete); placing an order and when the contract is formed (on payment); prices (tax inclusive, `STORE_CURRENCY`) and payment by card through Stripe; promo codes (one per order, rules from spec 0014); delivery (points to `/shipping`); right of withdrawal (points to `/returns`); complaints (rękojmia, the statutory warranty for non conforming goods: how to file, 14 day answer); out of court dispute resolution; governing law; how the terms change and which version applies to an order (the one accepted at checkout).
- **Privacy policy** (`/privacy`): the controller (seller placeholders); what data is collected (checkout email, name, address, phone; account data; cart; order history); purposes and legal bases (contract, legal obligation for tax records, legitimate interest for fraud prevention); processors (Supabase for hosting and auth, Vercel for hosting, Stripe for payments, Resend for email); retention (expired order PII purged after the spec 0008 period, account deletion under spec 0012, paid orders kept for tax law); data subject rights and how to use them; the right to complain to the supervisory authority (UODO in Poland); cookies (points to `/cookies`).
- **Returns** (`/returns`): the 14 day withdrawal right from delivery, how to tell the seller, sending the goods back within 14 days, who pays return shipping, refunds within 14 days to the original card (spec 0010 refunds), exceptions; the model withdrawal form (AC-6).
- **Shipping** (`/shipping`): the one country served (`STORE_COUNTRY`), the live fee and free delivery rule (AC-5), carriers and typical delivery time (`[[TO FILL]]`), the shipped email with tracking (spec 0011).
- **Cookie policy** (`/cookies`): what cookies are, the three categories, how to change your choice (the Cookie settings button), GPC respected, then the registry table (AC-17).

## Decision

**Chosen option**: Markdown in the repo for the pages, a required and recorded terms checkbox at checkout, and a small first party consent system gated on the cookie registry.

The five legal texts are Markdown files bundled into the build with a validated front matter date that doubles as the version; checkout records the accepted terms version on each order; consent is a browser written cookie read through a tiny React API, and the banner appears only once an optional cookie is registered.

**Implementation skills**: `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) for the dialog, checkbox and alert · `prisma-cli` (`prisma/skills`, `.agents/skills/prisma-cli/`) for the migration · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) for the CHECK and the migration · `next-cache-components` (Vercel plugin skill) for keeping the legal pages and the store shell static.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Module layout** (shared code in `src/lib/`, so checkout, account, orders and emails never import another feature's internals):

| Path | Owns |
|---|---|
| `src/lib/legal/content/{terms,privacy,returns,shipping,cookies}.md` | The texts, each with front matter `title`, `description`, `updated`. |
| `src/lib/legal/front-matter.ts` | Pure. Splits `---` front matter from the body and parses the three keys with Zod (no YAML dependency; only `key: value` lines). |
| `src/lib/legal/placeholders.ts` | Pure. `fillPlaceholders(body, values)`, throwing on an unknown `{{name}}`; `findFillMarkers(text)`. |
| `src/lib/legal/documents.ts` | `import "server-only"`. Imports the five files as raw strings, parses them once at module load, and exports `legalDocuments` (slug, path, title, description, `updated`, body) and `currentTermsVersion`. Applies the AC-4 production guard. |
| `src/lib/legal/paths.ts` | Pure, no server import. `legalPaths` (`/terms`, …) and `legalLinkLabels`, so client components and the email builder can link without the texts. |
| `src/features/legal/` | `components/legal-page.tsx` (title, date, body), `components/legal-markdown.tsx` (the renderer), `components/cookie-table.tsx`, `shipping-values.ts` (AC-5). |
| `app/(store)/{terms,privacy,returns,shipping,cookies}/page.tsx` | Thin routes: `generateMetadata`, then `<LegalPage slug=… />`. |
| `src/lib/consent/consent.ts` | Pure. The cookie schema, `parseConsent(raw, policyVersion, nowMs)`, `serializeConsent`, `cookiesToDelete(previous, next, registry)`, `shouldShowBanner(...)`. |
| `src/lib/consent/registry.ts` | The AC-17 registry (data only). |
| `src/lib/consent/consent-provider.tsx`, `consent-gate.tsx`, `consent-banner.tsx`, `consent-dialog.tsx`, `cookie-settings-control.tsx` | `"use client"`. The React side of AC-15 to AC-22. |

**Raw Markdown import**: the `.md` files are bundled as strings at build time (a Turbopack rule in `next.config.ts` running `scripts/raw-text-loader.cjs` on `src/lib/legal/content/*.md`, and the same transform for Vitest in its config), never read with `fs` at runtime, so a revalidated `/shipping` render and `startCheckout` never depend on file tracing. Add a `declare module "*.md"` typing beside them. Turbopack's own `raw` module type was tried first and dropped: it exports nothing a JavaScript import can read.

**Renderer**: `legal-markdown.tsx` is its own renderer, not the product description one (that one drops relative links and demotes `h1`). Allowed: `h2`, `h3`, `p`, `ul`, `ol`, `li`, `strong`, `em`, `a`, `blockquote`, `hr`. Raw HTML skipped. Links allowed: relative paths starting with `/`, `#` anchors, `https:` and `mailto:`; anything else becomes plain text. A Markdown `#` heading is an error in the draft (the title is the page `h1`), caught by a unit test over the five files.

**Build details** (settled in the cross check, so the build does not invent them):

1. **Shell and provider.** `StoreShell`'s `footerLinks` defaults to the legal links from `src/lib/legal/footer-links.ts` (shared code, so the shell imports no feature) instead of `[]` (the style guide keeps passing its demo links), so `app/not-found.tsx` gets them too. The `CookieSettingsControl` works with no `ConsentProvider` above it: it then stays a plain link to `/cookies`. `ConsentProvider` and the banner are mounted only in `app/(store)/layout.tsx`. The admin panel never renders `StoreShell`, which is what keeps it free of legal links and the banner. `store-shell.test.ts` gets a mock for the new client control.
2. **Dates.** One new pure helper, `formatCalendarDate(date: Date, locale: string)` in `src/lib/dates.ts` (`dateStyle: "long"`, `timeZone: "UTC"`), used for every terms or policy version: the legal pages, the `terms_changed` alert, the admin line, the email. A `YYYY-MM-DD` string becomes `new Date(\`${ymd}T00:00:00Z\`)`, and Prisma returns `@db.Date` at UTC midnight, so it is never formatted through `formatDate(..., STORE_TIMEZONE)`. The acceptance time on the admin page uses the existing `formatDateTime` in `STORE_TIMEZONE`. Front matter `updated` is checked as a real calendar date with `parseCalendarDay` (rejects 2026-02-31).
3. **Email.** `EmailFormat` (`src/lib/email/props.ts`) gains `siteUrl`, filled by `emailFormat()` in `src/lib/email/content.ts` from `NEXT_PUBLIC_SITE_URL`. The confirmation select in `content.ts` adds `termsVersion`, and `ConfirmationSource` gains `termsVersion: Date | null`. The pure `confirmationProps` builds `termsVersionLabel` (with `formatCalendarDate`) and `legalLinks` (`siteUrl` + `legalPaths`). `fixtures.ts`, `PreviewProps` and the `render.test.ts` snapshots cover both a version and none.
4. **Checkout schema and action.** `acceptTerms` joins `checkoutSchema(country)` as `z.literal(true, { error: "Tick the box to accept the terms of sale." })`; the form default is `false`. `checkoutFields` and `checkoutFieldErrors` learn `acceptTerms`, so the server field error and focus work like any other field; `CheckoutPrefill` and `emptyPrefill` do not change. `termsVersion` is not a user field: `startCheckout(input)` reads it from the same input object but parses it with its own schema (`YYYY-MM-DD`, a real date), and the form holds it in component state from the page prop, never in an editable field. The version comparison is the first thing `run` does after parsing, before `getCustomer()` and any database call. `StartCheckoutError` gains the `terms_changed` arm. The form maps it to the AC-10 alert through its existing `FormNotice`, and `logCheckoutRefused` logs `code` only. The checkbox is wired with `aria-invalid` and `aria-describedby` to its error, like the other fields.
5. **Order write.** `run` takes `acceptedAt = new Date()` once, after the version check. `createPendingOrder` gains `terms: { version: Date; acceptedAt: Date }` and writes both columns in its create. A replaced or restarted checkout creates a new order with its own fresh values and copies nothing from the old one. The CHECK lives only in the SQL migration (Prisma can't express it). A db test proves it with a raw update that clears one column of a created order, and the purge db test (`purge-expired`) asserts both columns survive a purge.
6. **Raw Markdown.** `next.config.ts` gains a `turbopack.rules` entry running `scripts/raw-text-loader.cjs` (`export default <JSON string>`, `as: "*.js"`) on only `src/lib/legal/content/*.md` (scoped with a path condition, Turbopack only). `vitest.config.mts` gains a small inline plugin that turns those same files into `export default <JSON string>`. A `declare module "*.md"` (default export `string`) sits in `src/lib/legal/content/markdown.d.ts`. Check that `next dev` reloads on a text edit.
7. **Text normalisation and the guard.** The loader strips a leading BOM and turns CRLF into LF before parsing. The draft note is an HTML comment at the top of the body, and the loader removes it before `findFillMarkers` and rendering, so the note may mention the marker without tripping the guard. A seller placeholder whose `brand.legal` field is `null` renders `[[TO FILL: seller.address]]` (the field name), which the production guard then catches. The guard test runs `next build` with `VERCEL_ENV=production` against a fixture text holding a marker, and expects it to fail. At runtime the same throw also protects `startCheckout`, which imports `documents.ts`.
8. **Renderer.** `legal-markdown.tsx` is built on `react-markdown`, like the product renderer, with no plugins beyond its own element filter. External `https:` links get `rel="noopener noreferrer"`. Headings get no ids (no anchor links in v1).
9. **Hydration and the banner.** The link to button switch, the provider's first read and the banner use `useSyncExternalStore` with a server snapshot of "not ready", the pattern the checkout form already uses (`noSubscription`). While the banner shows, a `ResizeObserver` on it sets `scroll-padding-bottom` on `<html>` to its height, and the padding is removed when it hides. Syncing a choice made in another tab is out of scope: the other tab picks it up on its next load.
10. **Registry.** `CART_COOKIE` moves to a pure module (`src/lib/cart/cookie-name.ts`) so the client registry imports it instead of repeating the string; `cookie.ts` imports it from there. A unit test greps `src/` and `app/` for cookie names the code sets (`cookies().set`, `document.cookie =`) and asserts each is in the registry. A policy version is a date, so the cookie policy can change at most once a day without a new version, which is accepted.
11. **Named files.** The admin line reads both columns through `getAdminOrder` in `src/features/orders/admin-queries.ts` and renders in `components/admin-order-detail.tsx`. The sign up notice goes in `src/features/account/components/sign-up-form.tsx`, with an e2e assertion on `/account/sign-up`. The checkout page (`app/(store)/checkout/page.tsx`) imports `currentTermsVersion` from `documents.ts` and passes it down to `checkout-form.tsx` as a prop.
12. **E2E GPC.** GPC is emulated with `page.addInitScript` defining `navigator.globalPrivacyControl` as `true`. No request header is used, because the store reads the signal only in the browser.
13. **Static rendering.** The legal pages need no `dynamic` or `revalidate` export: under `cacheComponents`, a page that reads no request data prerenders. `/shipping`'s cached settings read needs the database at build time, exactly like the catalog pages today.

**Data model sketch**:

| Table | Column | Type | Null | Notes |
|---|---|---|---|---|
| `orders` | `terms_version` | `date` | yes | The accepted terms `updated` date. |
| `orders` | `terms_accepted_at` | `timestamptz(3)` | yes | Server time at Pay. |

- CHECK `orders_terms_acceptance_check`: `(terms_version IS NULL) = (terms_accepted_at IS NULL)`.
- No index (never filtered on). No new table, so no new RLS statement; `orders` already has RLS on.
- Prisma: `termsVersion DateTime? @map("terms_version") @db.Date`, `termsAcceptedAt DateTime? @map("terms_accepted_at") @db.Timestamptz(3)`.
- The consent choice is not in the database (cookie only, AC-15).

**State transitions**: none on orders (the columns are written once at creation, never changed). Consent in the browser: `no choice` → `decided` (Accept all, Reject all, Save) → `decided` (Save again) ; `decided` → `no choice` when the cookie policy `updated` changes or 12 months pass. GPC is a default, not a state.

**API surface**:

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/terms`, `/privacy`, `/returns`, `/shipping`, `/cookies` | GET pages | none | static HTML | public | none (a broken file fails the build) |
| `startCheckout` (changed) | server action | existing inputs + `acceptTerms: true` (req), `termsVersion: string YYYY-MM-DD` (req) | `{ url }` as today | as today | `validation` (field `acceptTerms`), new `terms_changed { currentVersion }` |
| `ConsentProvider` / `useConsent` / `ConsentGate` | client API | `policyVersion`, `registry` | `{ ready, analytics, marketing, openSettings }` | browser only | invalid cookie reads as no choice |
| Order confirmation email (changed) | template props | `termsVersionLabel: string \| null`, `legalLinks: { terms, returns, privacy }` | email | n/a | none |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Legal page | title, description, "Last updated" | the file's front matter (`legalDocuments`) |
| Legal page | canonical URL | `NEXT_PUBLIC_SITE_URL` + `legalPaths[slug]` |
| Legal page | seller name, address, tax id, registration, email, phone | `brand.legal` in `src/lib/brand/brand.ts` (new block, all `string \| null`) |
| `/shipping` | delivery fee, free delivery rule | `getShippingSettings()` + `formatMoney` with `STORE_CURRENCY`, `STORE_LOCALE` |
| Any formatted calendar date | long date text | `Intl.DateTimeFormat(STORE_LOCALE, { dateStyle: "long", timeZone: "UTC" })` on `YYYY-MM-DDT00:00:00Z` |
| Checkout page | `termsVersion` the form sends | `currentTermsVersion`, read by the server page and passed to the form as a prop |
| `startCheckout` | current version to compare | `currentTermsVersion` |
| `startCheckout` | `terms_version`, `terms_accepted_at` | the validated input; `new Date()` at Pay |
| `terms_changed` alert | the new date | `currentVersion` in the error, formatted as above |
| Admin order page | version and time | `orders.terms_version`, `orders.terms_accepted_at` in `STORE_TIMEZONE` |
| Confirmation email | version line, links | `orders.terms_version` formatted by the sender; `NEXT_PUBLIC_SITE_URL` + `legalPaths` |
| Consent cookie | `v` | `/cookies` front matter `updated`, passed from the store layout to `ConsentProvider` |
| Consent cookie | `at` | `Date.now()` in the browser at the choice |
| Banner visibility | optional cookies exist | `registry` entries with category `analytics` or `marketing` |
| Banner visibility | GPC | `navigator.globalPrivacyControl` |
| Withdrawal | cookie names to delete | `cookiesToDelete(previous, next, registry)` |

**Key invariants**:
- No order is created after this feature ships without `terms_version` and `terms_accepted_at`; the version stored equals the version the customer's form showed.
- The two columns are both null or both set (DB CHECK).
- No `analytics` or `marketing` cookie, script or storage exists in the browser unless `useConsent()` reports that category granted. Every optional cookie is in the registry; adding one means bumping the `/cookies` `updated` date, which asks everyone again.
- Refusing is never harder than accepting: Accept all and Reject all are always side by side with the same style, in the banner and the dialog.
- Rendering a page never sets a cookie (spec 0001); only the browser writes `bestore_consent`.
- The legal pages and the store shell stay static: neither the pages nor the provider read cookies on the server.
- Legal texts in production contain no `[[TO FILL` marker and no unfilled `{{…}}`.

**Security model**:
- Compliance scope: GDPR (consent for optional cookies must be prior, informed, granular and as easy to withdraw as to give; ability to show what was offered), the ePrivacy rule on storing anything on a device (only strictly necessary storage without consent), EU and Polish consumer law (pre contract information, the 14 day withdrawal right with the model form, terms available free before the contract in a printable form).
- The legal pages are public and read only. `bestore_consent` is not trusted by the server for anything; it only controls what the browser loads.
- Terms acceptance is enforced on the server in `startCheckout`, never only in the form.
- The admin order page stays behind `requireAdmin()` as today; the new line adds no new data path.
- Audit trail: the order columns are the record of acceptance; consent proof rests on the cookie plus the banner code and registry in git history (the engineer chose no server log).
- Logs: `checkout.refused` carries `code: "terms_changed"` or the `validation` field names, never the email.

**Configuration required**: no new environment variables. New values in `brand.legal` (code, filled before launch). `next.config.ts` and the Vitest config gain the raw Markdown rule.

**Critical test scenarios**:
- Happy path: a guest ticks the box and pays; the order row has `terms_version` = the terms date and `terms_accepted_at` set; the admin order page and the confirmation email show the version, verifies **AC-8**, **AC-11**, **AC-13**, **AC-14**
- Failure case: `startCheckout` called with an older `termsVersion` returns `terms_changed`, creates no order (db test counts orders before and after), and the form shows the alert with the box unticked, verifies **AC-9**, **AC-10**
- Failure case: Pay unticked shows the field error and no request reaches the server; a direct call with `acceptTerms: false` returns `validation`, verifies **AC-8**, **AC-9**
- Consent: on the style guide demo, Reject all writes `analytics:false`, no `demo_` cookie appears, reload hides the banner; Accept all then turning analytics off in the dialog deletes the `demo_` cookie and reloads, verifies **AC-15**, **AC-19**, **AC-20**, **AC-24**
- Consent: with GPC emulated, the demo banner does not show and the gate stays closed until the customer opts in, verifies **AC-21**
- Privacy: a first visit to home, product, cart and checkout, with JavaScript on and off, leaves only necessary cookies and empty web storage, verifies **AC-23**
- Static: a build with a `{{unknown}}` placeholder fails; `VERCEL_ENV=production` with a `[[TO FILL` marker throws, verifies **AC-4**
- Live values: changing the fee in `/admin/settings` changes `/shipping` on the next load, verifies **AC-5**
- Permission: an anonymous visitor reaches every legal page; the admin panel shows no legal footer and no banner, verifies **AC-3**, **AC-18**

## Build plan

Tracer Bullet: the first slice runs one legal page through every layer (content file, loader, page, footer, checkout, database, admin, email) before the other pages and the consent system are added.

1. **Thin thread, terms end to end.** Raw Markdown rule in `next.config.ts` and the Vitest config; `front-matter.ts`, `placeholders.ts`, `paths.ts`, `documents.ts` with unit tests; `brand.legal` block; `legal-markdown.tsx` and `legal-page.tsx`; `app/(store)/terms/page.tsx` with metadata; the terms draft; footer link through `StoreShell`'s `footerLinks`, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-7**
2. Migration for the two `orders` columns and the CHECK; `startCheckout` takes `acceptTerms` and `termsVersion`, checks them before any database work, writes both columns in the order transaction; checkout form checkbox, field error, links and the Returns and Shipping line; the checkout page passes `currentTermsVersion`; db test plus e2e for tick and pay, satisfies **AC-8**, **AC-9**, **AC-11**
3. Admin order page "Terms accepted" line; confirmation email version line and links (props built in the sender, `PreviewProps` updated, both with and without a version), satisfies **AC-13**, **AC-14**
4. `terms_changed` handling in the form (alert, untick, new version, focus) with an e2e that calls the action with an old version, satisfies **AC-9**, **AC-10**
5. The other four pages and drafts: privacy, returns (with the model withdrawal form), shipping (with `shipping-values.ts` and the live settings), cookies; all five footer links in order; print styles; sign up notice; a unit test that every draft has front matter, no `#` heading and only known placeholders, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-6**, **AC-7**, **AC-12**
6. Consent core: `consent.ts` (schema, parse, serialize, `cookiesToDelete`, `shouldShowBanner`) with unit tests; `CART_COOKIE` moved to a pure module; `registry.ts` with the test that every cookie the code sets is listed; `ConsentProvider`, `useConsent`, `ConsentGate` mounted in the store layout; the cookie table on `/cookies`, satisfies **AC-15**, **AC-17**, **AC-22**
7. Settings dialog and the Cookie settings control (link before hydration, button after) in the footer and on `/cookies`; banner with the visibility rule, DOM position, scroll padding; withdrawal delete and reload; GPC, satisfies **AC-16**, **AC-18**, **AC-19**, **AC-20**, **AC-21**
8. Style guide Consent demo with the demo registry and its e2e (banner buttons, dialog, withdrawal reload, GPC through an init script defining `navigator.globalPrivacyControl`), and the first visit cookie and storage e2e with scripts on and blocked (`blockAppScripts`), plus axe checks on a legal page, the banner and the dialog, satisfies **AC-19**, **AC-20**, **AC-21**, **AC-23**, **AC-24**

## Consequences

**Positive**:
- Every order from now on carries proof of which terms applied, visible where disputes are handled.
- Feature 18 gets a ready consent API and only has to register its cookies and wrap its script in `ConsentGate`; the banner then appears by itself.
- The pages stay static and cheap, and every text change is a reviewed commit with history.
- No new dependency, no third party script, no new table.

**Negative / tradeoffs**:
- Editing a legal text needs a developer and a deploy; admins cannot fix a typo themselves.
- Old versions of the terms are only in git history, not on the site; answering "show me the version from March" means checking out a commit.
- Consent proof is the cookie plus git history, not a server log; if a regulator asks for per visitor records, there are none.
- Checkout gains one more required step, which costs a little conversion, and a new refusal (`terms_changed`) a customer can hit when the terms change during their visit.
- The drafts are not legal advice; until a lawyer reviews them, launching on them is a risk the production guard only partly covers (it catches blanks, not wrong law).

**Neutral**:
- One migration with two nullable columns and a CHECK; old orders read "not recorded".
- `next.config.ts` gains a Turbopack rule; Vitest gains the matching transform.
- A new `src/lib/legal/` and `src/lib/consent/` area, and a `src/features/legal/` feature, each worth a nested `AGENTS.md` at `/sync` time.

## Follow-up

- [ ] Language: the store sells to consumers in Poland, where consumer contract terms generally have to be offered in Polish. The drafts follow the store's current language (`STORE_LOCALE`, English today). Settle the final language with the lawyer before launch; a Polish version may mean switching `STORE_LOCALE` or adding translated files.
- [ ] Legal review of all five drafts and the checkout and sign up wording before launch (feature 19 should not ship while any `[[TO FILL` remains, which the AC-4 guard enforces).
- [ ] Fill `brand.legal` (and `brand.contactEmail`) with the real seller details.
- [ ] Feature 18: register each analytics cookie in `src/lib/consent/registry.ts`, bump the `/cookies` `updated` date, and wrap scripts in `ConsentGate`. If it picks a cookieless analytics tool, decide whether it needs consent at all; server side events (the paid webhook) carry no cookie and are outside this gate.
- [ ] Feature 17: add the five legal pages to the sitemap.
- [ ] `/sync`: add nested `AGENTS.md` files for `src/lib/legal/`, `src/lib/consent/` and `src/features/legal/`, and a root rule that every new cookie or web storage key goes in the consent registry.
