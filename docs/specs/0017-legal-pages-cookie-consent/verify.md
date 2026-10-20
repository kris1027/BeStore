# Verify: Legal pages & cookie consent · spec 0017 · updated 2026-10-20
_Steps derived from spec 0017 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open `/terms`, `/privacy`, `/returns`, `/shipping`, `/cookies` → one `h1` with the front matter title, "Last updated October 20, 2026", the Markdown body, no `{{` text → AC-1
- [ ] View source of each legal page → `<title>` is the front matter title, `meta description` set, `link rel=canonical` is `NEXT_PUBLIC_SITE_URL` + path, no `noindex` meta and no `X-Robots-Tag` header → AC-2
- [ ] On `/`, `/cart`, a 404 page and `/style-guide` → footer nav lists Terms of sale, Privacy policy, Returns, Shipping, Cookie policy, then Cookie settings (the style guide keeps its demo links, then Cookie settings) → AC-3
- [ ] Open `/admin` signed in → no legal footer links, no consent banner → AC-3, AC-18
- [ ] Print preview a legal page → header, footer and banner hidden, only the text prints → AC-3
- [ ] With `brand.legal` fields null, the pages show `[[TO FILL: seller.name]]` etc. outside production → AC-4
- [ ] `/returns` ends with "Model withdrawal form", the seller name, address and email filled in, and the "print it, or copy it into an email" line → AC-6
- [ ] Each draft starts with a DRAFT HTML comment (not rendered) and covers the content outline sections → AC-7
- [ ] `/checkout`: the box is unticked, its links and the Returns / Shipping line open in a new tab and announce it; Pay unticked shows "Tick the box to accept the terms of sale.", focuses the box, sends no request; Pay stays enabled → AC-8
- [ ] `/checkout`: make the page's version stale (edit `terms.md` `updated` while the page is open, then Pay ticked) → alert "Our terms of sale changed on <date>. Please read them and tick the box again.", box unticked and focused, other fields kept; tick again and Pay → goes to Stripe → AC-9, AC-10
- [ ] Pay ticked → the new order row has `terms_version` = the terms `updated` date and `terms_accepted_at` ≈ now → AC-11
- [ ] `/account/sign-up` shows "By creating an account you accept the terms of sale and confirm you have read the privacy policy." with new tab links → AC-12
- [ ] `/admin/orders/<n>` for that order → "Terms accepted: version October 20, 2026, on <date time in STORE_TIMEZONE>"; for an older order → "not recorded" → AC-13
- [ ] Confirmation email (Mailpit, or `pnpm email:dev`) → "Terms of sale version October 20, 2026 applied to this order." above the footer, and absolute links to Terms of sale, Returns, Privacy policy; an order with no version omits the line, keeps the links → AC-14
- [ ] Footer "Cookie settings": a link to `/cookies` in the server HTML (curl), a button that opens the dialog after hydration; Necessary checked and disabled ("Always on"), Analytics and Marketing "Not used right now", disabled; Save choices, Accept all, Reject all → AC-16
- [ ] `/cookies` table lists `bestore_cart`, `bestore_consent`, `sb-<project ref>-auth-token`, `sidebar_state`, Stripe's own cookies; its "Cookie settings" button opens the dialog → AC-17
- [ ] On the store, no banner ever shows with today's registry → AC-18
- [ ] `/style-guide`: banner at the bottom right after the skip link, three equal buttons, no focus taken, `scroll-padding-bottom` set while shown → AC-19, AC-24
- [ ] `/style-guide`: Accept all → `demo_analytics` cookie appears; Open cookie settings, untick Analytics, Save → page reloads, `demo_analytics` gone → AC-20
- [ ] `/style-guide` with GPC (`navigator.globalPrivacyControl = true`) → no banner, demo Off, nothing written; opting in from settings turns it On and persists → AC-21
- [ ] Feature 18 API: `useConsent()` returns `{ ready, analytics, marketing, openSettings }`, `ConsentGate` renders nothing before mount → AC-22
- [ ] First visit to `/`, a product, `/cart`, `/checkout` with JS on and off → only necessary cookies; web storage empty with JS on → AC-23

## Commands
- [ ] `pnpm test` → legal loader, placeholders, front matter, content drafts, consent, registry, schemas, email render all pass → AC-4, AC-7, AC-9, AC-14, AC-15, AC-17, AC-20, AC-21
- [ ] `pnpm test:db tests/db/start-checkout.db.test.ts` → terms recorded, `terms_changed` and unticked create no order, CHECK refuses one column alone → AC-9, AC-11
- [ ] `pnpm test:db tests/db/purge-expired-orders.db.test.ts` → both terms columns survive the purge → AC-11
- [ ] `VERCEL_ENV=production pnpm build` → fails while any `[[TO FILL` is left → AC-4
- [ ] `pnpm test:e2e tests/e2e/legal` and `tests/e2e/admin/settings.spec.ts` → all pass → AC-1 to AC-3, AC-5, AC-8, AC-10, AC-12, AC-13, AC-16 to AC-24

## Value sourcing
- [ ] Change `updated` in `terms.md` → the page date, `currentTermsVersion`, the checkout's sent version and the stored `terms_version` all follow → Value sourcing: front matter
- [ ] Set `NEXT_PUBLIC_SITE_URL` to another origin → canonical URLs and email links follow → canonical, email links
- [ ] Fill one `brand.legal` field → it replaces its marker on every page → seller placeholders
- [ ] Save fee 9.99 and threshold 50 in `/admin/settings` → `/shipping` shows "€9.99" and "Delivery is free on orders of €50.00 or more." on next load; clear the threshold → "The same fee applies to every order." → `/shipping` values
- [ ] Set `STORE_LOCALE=pl-PL` → dates read "20 października 2026" on pages, the admin line and the email, never a day off (version formatted in UTC) → calendar dates
- [ ] Accept at 23:30 Warsaw time → admin "on" time shows the Warsaw time, the version stays the file's date → admin version and time
- [ ] Change `cookies.md` `updated` → a saved demo choice no longer counts, the banner asks again → consent cookie `v`
- [ ] Set a consent cookie with `at` older than 12 months → reads as no choice → consent cookie `at`
- [ ] Demo registry with an analytics entry → banner shows; real registry → never → banner visibility, optional cookies
- [ ] GPC on → banner hidden → banner visibility, GPC
- [ ] Withdraw analytics with `demo_analytics` set → only that cookie deleted → withdrawal cookie names

## Acceptance-criteria coverage
- AC-1, AC-2: legal pages e2e, front matter and loader unit tests · AC-3: footer e2e, store shell unit, print e2e, admin e2e · AC-4: loader and content unit tests, production build · AC-5: settings e2e, shipping values unit · AC-6: content unit, returns e2e · AC-7: content unit · AC-8: terms box e2e · AC-9: schema unit, start-checkout db · AC-10: terms changed e2e · AC-11: start-checkout and purge db · AC-12: sign up e2e · AC-13: admin db and e2e · AC-14: render unit, order emails db · AC-15: consent unit · AC-16: store consent e2e · AC-17: registry unit, /cookies e2e · AC-18: store e2e · AC-19: demo e2e · AC-20: consent unit, demo e2e · AC-21: demo GPC e2e · AC-22: gate via demo e2e · AC-23: first visit e2e · AC-24: demo e2e
