# 0017. Legal pages and cookie consent: rationale

The decision record behind [index.md](index.md). `/develop` builds from `index.md` and skips this file.

## Context

> ⚠️ Premise note: the store has no analytics or marketing cookies today; they arrive with feature 18. A banner asking for consent to cookies that don't exist collects meaningless consent and teaches customers to click past it. The right framing is to build and test the consent system now, and let the banner appear only once an optional cookie is registered. The engineer agreed.

> ⚠️ Premise note: the store sells only to consumers in Poland (`storeCountries = ["PL"]`), and Polish law generally expects consumer terms in Polish, while the store's language is set by `STORE_LOCALE` (English today). Drafting in English is fine for review, but the launch text's language is a legal call, recorded as a Follow-up rather than decided here.

BeStore is a single brand shop selling to consumers in one EU country (Poland), with guest and account checkout and card payment through Stripe's hosted page. Before launch it needs the texts a consumer shop must publish: terms of sale (the contract), a privacy policy (GDPR information duties), the withdrawal right with the EU model form, delivery terms, and a cookie policy. Polish law also requires the terms to be available free, before the contract, in a form the customer can save and print. The compliance scope is GDPR, the ePrivacy rule on device storage, and EU and Polish consumer law.

The terms matter beyond being published. When a customer disputes an order, the store has to know which version of the terms applied. Today nothing links an order to any text. The terms will change over time (new promo rules, carriers, prices), so "the current terms" is not an answer for an order placed last year.

On cookies, the app today sets only strictly necessary ones: the signed cart cookie and the Supabase auth cookies; no code touches `localStorage` or `sessionStorage`. Feature 18 (analytics and error tracking) will want to load tracking, and the scope says that must respect consent. EU regulators check that consent is prior (nothing loads before a yes), granular (per purpose), informed, and that refusing is as easy as accepting and withdrawing as easy as giving. Feature 18 should not have to design that from scratch.

The stack shapes the solution: Cache Components keep the store shell static, so anything reading request cookies on the server pushes pages behind Suspense. Features must not import each other's internals, yet checkout, accounts, admin orders and the confirmation email all need to know the terms version and the legal paths. `react-markdown` is already installed for product descriptions, and `StoreShell` already has an empty `footerLinks` slot reserved for this feature.

## Options considered

### Where the legal text lives

#### Option 1: Markdown files in the repo (chosen)

One `.md` file per page with a small front matter block (`title`, `description`, `updated`), bundled into the build and rendered with `react-markdown`.

**Pros**:
- Every change is a reviewed commit with author, diff and date; git history is the archive of old versions.
- Pages stay fully static with no new table, editor or cache tag.
- Reuses an installed dependency.

**Cons**:
- Only a developer can change the text, and every change needs a deploy.
- Old versions are not browsable on the site.

#### Option 2: Admin editable pages in the database

A `legal_pages` table and a Markdown editor in `/admin`, with a cache tag per page.

**Pros**:
- Non developers can edit without a deploy.
- Versions could be stored as rows and shown on the site.

**Cons**:
- A migration, an editor page, actions, cache tags, tests, and a versioning scheme to get the "which version applied" guarantee right.
- Legal text changes stop being reviewed like code; a stray edit goes live instantly.

#### Option 3: Text written in TSX pages

The text lives directly in React components.

**Pros**:
- No parser and no raw import rule.

**Cons**:
- Legal prose mixed with markup is hard to edit and to review, and a lawyer cannot work on the file.

### How terms acceptance is captured

#### Option 1: Required checkbox, recorded on the order (chosen)

An unticked checkbox above Pay, enforced by `startCheckout`, saving the terms version and time on the order.

**Pros**:
- Standard practice for Polish shops, and proof of exactly which text applied to each order.
- Enforced on the server, so no client trick skips it.

**Cons**:
- One more step at checkout, plus a migration and a new refusal when the terms change mid visit.

#### Option 2: Required checkbox, not recorded

**Pros**:
- No migration.

**Cons**:
- No proof of which version applied to a disputed order.

#### Option 3: Notice text only

"By paying you accept the terms" under Pay.

**Pros**:
- No friction, no new code path.

**Cons**:
- Weaker under Polish practice, and still no record.

#### Option 4: Stripe Checkout's terms checkbox

`consent_collection.terms_of_service` on Stripe's hosted page.

**Pros**:
- Stripe shows and enforces it.

**Cons**:
- Acceptance happens after our order exists and lives only in Stripe; the order row and admin page know nothing.

### How consent is managed

#### Option 1: A small first party consent system (chosen)

A browser written cookie with the choice, a registry of every cookie, a React provider with `useConsent` and `ConsentGate`, a shadcn styled banner and dialog.

**Pros**:
- No third party script; the static shell, the visual style and the WCAG baseline stay under our control.
- The registry drives the cookie policy table and the banner's visibility, so they cannot drift apart.

**Cons**:
- We own the edge cases (cookie deletion on withdrawal, GPC, re asking on policy change) and their tests.
- No automatic cookie scanning: a developer must register each new cookie.

#### Option 2: An open source consent library (vanilla-cookieconsent)

**Pros**:
- Banner, categories, script blocking and translations are done and widely used.

**Cons**:
- Its own markup and styles fight the shadcn look; one more dependency to keep current; React integration is a wrapper around an imperative API.

#### Option 3: A hosted consent platform (Cookiebot, CookieYes)

**Pros**:
- Cookie scanning, a server side consent log, Google Consent Mode support.

**Cons**:
- A third party script that must load before everything else on every page, a monthly cost, and a banner style we only partly control.

## Rationale

The texts belong in the repo because the hard requirement here is knowing which text applied to which order, and git already gives an exact, reviewed, dated history for free. With the version being the file's `updated` date, the order only needs to store that date: no versions table, no editor, no new cache tag. An admin editor would solve a problem this shop does not have yet (frequent non developer edits) and would make the important guarantee harder, because any edit would go live unreviewed. The cost, a deploy per text change, is acceptable for documents that change a few times a year. Bundling the files as raw strings (rather than reading them with `fs`) keeps `startCheckout` and the revalidated `/shipping` page independent of file tracing on Vercel.

The recorded checkbox is chosen because the record is the point. Polish shops conventionally ask for explicit acceptance of the terms, and storing the version on the order turns "the customer agreed" into "the customer agreed to the 2026-10-20 text". Comparing the version the form showed with the current one closes the one gap left: a customer who opened checkout before a deploy is never bound to text they had no chance to open. The check runs before any lock or write, so it costs nothing on the hot path. Stripe's checkbox was rejected because the acceptance would land after our order exists and outside our data.

A first party consent system fits because the store has no optional cookies yet, so a hosted platform would be paying for a scanner with nothing to scan, and both third party options add a script that sits in front of the static shell the project worked to keep. The registry is the piece that makes the small system safe: it is the single list behind the cookie policy table, the withdrawal deletion and the banner's visibility, so the store cannot show a banner for nothing or forget to delete a cookie it knows about. Mounting the banner after hydration keeps the server HTML free of request data; without JavaScript no optional script can run, so there is nothing to consent to. Keeping proof to the cookie (no server log) was the engineer's call; it is enough for a small first party shop, and the follow up is cheap if feature 18 brings a tool that needs a log.
