# Legal pages

## Overview

The storefront pages `/terms`, `/privacy`, `/returns`, `/shipping` and `/cookies`, and the legal links in the store footer. The texts and their versions live in `src/lib/legal/`; the consent banner and dialog live in `src/lib/consent/`. Governing spec: [0017 Legal pages and cookie consent](../../../docs/specs/0017-legal-pages-cookie-consent/index.md).

## Files

- `app/(store)/{terms,privacy,returns,shipping,cookies}/page.tsx`: thin routes, `legalMetadata(slug)` then `<LegalPage slug=... />`.
- `components/legal-page.tsx`: `server-only`. `legalMetadata` (title, description, canonical from `NEXT_PUBLIC_SITE_URL`) and `LegalPage` (the `h1`, the "Last updated" date, the body).
- `components/legal-markdown.tsx`: its own `react-markdown` renderer, not the product description one. Only `h2`, `h3`, `p`, lists, `strong`, `em`, `a`, `blockquote`, `hr`; raw HTML skipped; links only to `/...`, `#...`, `https:` and `mailto:`.
- `components/cookie-table.tsx`: the registry as the table on `/cookies`.
- `components/footer-links.ts`: `legalFooterLinks`, which `StoreShell` uses by default, so the 404 page has them too.
- `shipping-values.ts`: pure. The live delivery fee and free delivery rule `/shipping` fills in.

## Conventions

- The pages read no request data, so they prerender with no `dynamic` or `revalidate` export. `/shipping` adds only the cached `getShippingSettings()` read, which an admin save expires.
- The admin panel never renders `StoreShell`, which keeps legal links and the banner out of it.

## Tests

`tests/e2e/legal/legal-pages.spec.ts` (pages, footer, checkout links, axe) and `tests/e2e/legal/consent.spec.ts` (banner, dialog, withdrawal, GPC, first visit cookies and storage).

_Drafted by /sync from the introducing change, worth a quick human pass._
