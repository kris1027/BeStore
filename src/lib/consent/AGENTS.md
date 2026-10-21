# Cookie consent

## Overview

A small first party consent system: the `bestore_consent` cookie written by the browser, the cookie registry, a provider, a gate, the banner and the settings dialog. Mounted only in `app/(store)/layout.tsx`, so the admin panel never shows the banner. Governing spec: [0017 Legal pages and cookie consent](../../../docs/specs/0017-legal-pages-cookie-consent/index.md).

## Files

- `consent.ts`: pure. The cookie schema, `parseConsent`, `serializeConsent`, `cookiesToDelete`, `shouldShowBanner`, `acceptAllChoices`.
- `registry.ts`: `cookieRegistry`, every cookie the store sets, shown as the table on `/cookies`.
- `consent-provider.tsx`: `ConsentProvider`, `useConsent` (for feature 18: `{ ready, analytics, marketing, openSettings }`) and `useConsentState` (banner, dialog, settings control).
- `consent-gate.tsx`: `ConsentGate category=...`, renders its children only once mounted and granted.
- `consent-banner.tsx`, `consent-dialog.tsx`, `cookie-settings-control.tsx`: the UI. The control is a link to `/cookies` before hydration or with no provider above, and a button that opens the dialog after.

## Conventions

- Every cookie or web storage key the code sets goes in `registry.ts`. `registry.test.ts` greps `src/` and `app/` for cookie writes and fails on an unlisted name.
- An `analytics` or `marketing` entry makes the banner appear by itself. Adding one means bumping the `updated` date of `src/lib/legal/content/cookies.md`, which asks everyone again.
- Tracking code runs only inside `ConsentGate` or behind `useConsent()`; neither is ever true before mount.
- The server never reads the consent cookie, so the store shell and legal pages stay static. Browser reads go through `useSyncExternalStore` with a "not ready" server snapshot; never read `Date.now()` in render (Cache Components refuses it), the age check uses `performance.timeOrigin`.
- Accept all and Reject all always sit side by side with the same style, in the banner and the dialog. Global Privacy Control hides the banner and keeps every optional category off.
- Turning a category off deletes its registry matched cookies and reloads the page, so a running script stops.
- The real registry has no optional cookie today, so the banner never shows in the store. The style guide's Consent demo (`src/features/style-guide/components/consent-demo.tsx`) brings its own registry and policy version; `tests/e2e/legal/consent.spec.ts` drives it.

_Drafted by /sync from the introducing change, worth a quick human pass._
