# Account

## Overview

Optional customer accounts under `/account`: sign up, confirm, choose a password, sign in and out, forgot password, order history and detail, the address book, settings (profile, password, delete account), and the "Create an account to track this order" offer on the confirmation page. Guest checkout stays the default. It runs on the same Supabase Auth user pool as the admin panel. Code that checkout and cart also need lives in `src/lib/customer/` and `src/lib/cart/merge.ts`. Governing spec: [0012 Customer accounts](../../../docs/specs/0012-customer-accounts/index.md). Production setup: [docs/runbooks/customer-accounts.md](../../../docs/runbooks/customer-accounts.md).

## Files

- `app/(store)/account/(auth)/`: the public pages (sign in, sign up, forgot password, confirm, set password). `(area)/`: the signed in pages (orders, order detail, addresses, settings).
- `actions/`: `sign-up.ts`, `sign-up-from-order.ts`, `confirm.ts` (`confirmEmail`, the POST that spends the token), `set-password.ts`, `sign-in.ts`, `password-reset.ts`, `addresses.ts`, `settings.ts`.
- `paths.ts`: pure. Every account URL, which pages are public, and `safeAccountNext`, the only `next` values sign in may follow (`/checkout` or a non auth page under `/account`).
- `proxy.ts`, `proxy-decision.ts`: the first gate, called from the root `proxy.ts` for `/account` and `/checkout`. Refreshes the session, redirects signed out visitors to sign in, sets `Cache-Control: no-store` on account pages.
- `guards.ts`: `redirectIfSignedIn` for the sign in and sign up pages.
- `queries.ts`, `order-view.ts`: order history and detail; `order-sign-up.ts`: when the confirmation page may offer sign up.
- `send-email-hook.ts`: `handleSendEmailHook`, behind `POST /api/auth/send-email` (AC-8). Checks the Standard Webhooks signature, picks the template (admin reset first) and sends it within 4 seconds; the pure parts live in `src/lib/email/auth-hook.ts`.
- `sign-up-email.ts`, `throwaway-password.ts`, `settle.ts`: the sign up call made in `after()` with a password nobody knows, and its failure as a reason code.
- `src/lib/customer/session.ts`: `getCustomer`, `getCustomerId`, `requireCustomer`. `setup.ts`: `accountSetup` (customer row, guest order links, cart merge). `lock.ts`: `lockCustomer`. `addresses.ts`, `address-rules.ts`: the address book. `store-admin.ts`: `runsTheStore`. `log.ts`: `account.*` events.
- `src/lib/auth/password.ts`: the one password schema for admin pages, account pages and scripts, mirroring `password_requirements` in `supabase/config.toml`. Keep the two in step.

## Conventions

- Every account page and action below the auth pages calls `requireCustomer()` itself; the proxy is only the first gate and never redirects a server action POST.
- `getCustomer` uses `getUser()` (asks the Auth server), never `getClaims()`, so a deleted or revoked account fails at once. The proxy may use `getClaims()` because it only hints.
- A customer is a confirmed Supabase user; the `customers` row is created on demand under the customer lock. A live email conflict reads as signed out and logs `account.email_conflict`.
- One advisory lock per customer (`lockCustomer`) guards every write to their cart, addresses or order links. Take it before any cart or order row lock.
- Sign up never sets the real password: Supabase gets a throwaway one and the customer chooses theirs after confirming. Sign up and forgot password answer the same whatever the email, and the Supabase call runs in `after()`.
- Email links use the token hash pattern: the GET shows Continue, only the POST calls `verifyOtp`. `/account/confirm` sends `no-referrer` (set in `next.config.ts`).
- A user who runs the store (an `admin_users` row in any state, or a verified TOTP factor) always gets the admin reset email, keeps their password when a sign up link is confirmed, and cannot delete their account here. `auth.users` and `auth.mfa_factors` are read only, through `$queryRaw`.
- Signed in checkout uses the account email, whatever was typed. An order number that is missing, someone else's or hidden renders the same not found content.
- Logs carry the customer id, order ids and numbers, counts and reason codes only, never an email, name, address, password or token.

## Tests

Pure rules have `*.test.ts` beside them. Setup, addresses, settings, order links and order sign up run against a real database in `tests/db/account-*.db.test.ts` and `tests/db/order-sign-up.db.test.ts` (`pnpm test:db`, `tests/db/auth-stub.ts` stubs Supabase). Flows are in `tests/e2e/account/`, which read the emails from Mailpit (`EMAIL_TRANSPORT=mailpit`, needs `pnpm db:start` and `SEND_EMAIL_HOOK_URI` pointing at the port the app runs on).

_Drafted by /sync from the introducing change, worth a quick human pass._
