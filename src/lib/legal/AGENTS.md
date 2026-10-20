# Legal texts

## Overview

The five legal texts (terms, privacy, returns, shipping, cookies) as Markdown in the repo, bundled into the build as strings and parsed once at module load. Shared code, so checkout, account, orders and emails can read a version or link a page without importing `src/features/legal/`. Governing spec: [0017 Legal pages and cookie consent](../../../docs/specs/0017-legal-pages-cookie-consent/index.md).

## Files

- `content/{terms,privacy,returns,shipping,cookies}.md`: the texts. Front matter `title`, `description`, `updated` (`YYYY-MM-DD`, the text's version). `markdown.d.ts` types the `*.md` default export as `string`.
- `documents.ts`: `server-only`. `legalDocuments`, `currentTermsVersion` (what checkout accepts and stores on the order) and `cookiePolicyVersion` (what the consent cookie records).
- `load.ts`: pure `loadLegalDocuments`, the raw files to documents: front matter, seller and store placeholders, the draft comment stripped, the production guard.
- `front-matter.ts`, `placeholders.ts`: pure. `key: value` front matter checked with Zod (no YAML parser); `{{name}}` filling and `[[TO FILL: ...]]` markers.
- `acceptance.ts`: the `TermsAcceptance` type an order records (checkout writes it, admin orders read it).
- `paths.ts`: pure, no server import. `legalSlugs` (the footer order), `legalPaths`, `legalLinkLabels`, for client components and the email builder.
- `footer-links.ts`: `legalFooterLinks`, which `StoreShell` uses by default, so the 404 page has them too.

## Conventions

- The texts are never read with `fs`. `next.config.ts` runs `scripts/raw-text-loader.cjs` on `src/lib/legal/content/*.md` only, and `vitest.config.mts` has the same transform; a new legal file must live in `content/` to import.
- Changing a text's meaning means changing its `updated` date. A new terms date makes open checkouts answer `terms_changed`; a new cookies date asks every visitor for consent again.
- No Markdown `#` heading in a text (the title is the page `h1`) and no unknown `{{placeholder}}`: both fail `content.test.ts` or the build.
- Seller details come from `brand.legal` in `src/lib/brand/brand.ts`. A `null` field renders `[[TO FILL: seller.<field>]]`, and with `VERCEL_ENV=production` any marker throws at load, failing the build and `startCheckout`.
- `/shipping` keeps `{{deliveryFee}}` and `{{freeDeliveryRule}}` unfilled here; the page fills them per render from the cached shipping settings.
- Format a version with `formatCalendarDate` (UTC), never through `STORE_TIMEZONE`.
- The drafts are not legal advice: a lawyer reviews them before launch (spec 0017, Follow-up).

_Drafted by /sync from the introducing change, worth a quick human pass._
