# 0004. Admin sign in with required TOTP

**Date**: 2026-09-25
**Status**: In Progress

## Summary

Admins sign in to `/admin` with an email and password through Supabase Auth, then type a 6 digit code from an authenticator app (TOTP, a time based one time code). Both steps are required, every time. Only people with an active row in `admin_users` get in. Everyone else gets a plain 404, and each admin session ends 12 hours after sign in. Admin accounts are created, disabled and reset from small command line scripts, so there is no public sign up and no admin management screen to secure yet.

## Requirements

**User stories**:
- As an admin, I want to sign in with my email, password and authenticator code so that only I can act on the store as me.
- As an admin, I want to reset a forgotten password myself so that I am not locked out until someone runs a script.
- As the store owner, I want anyone who is not an active admin to find nothing at `/admin` so that the panel is not a target, and a disabled admin loses access on their very next click.
- As the store owner, I want to add, disable and recover admins from the terminal so that there is no admin management UI to build or attack.

**Acceptance criteria**:
- **AC-1**: A visitor with no session who opens any `/admin` page other than `/admin/sign-in` or `/admin/forgot-password` is redirected to `/admin/sign-in?next=<the requested path>`. The proxy (Next.js request hook) runs only on `/admin/:path*` and `/auth/:path*`; storefront routes never call Supabase.
- **AC-2**: An active admin with a verified TOTP factor who submits the correct email and password lands on `/admin/mfa`. After a correct 6 digit code they land on the `next` path when it passes AC-12, else on `/admin`. `/admin` shows "Signed in as <name>". The top bar user menu shows the admin's name and email and a Sign out item.
- **AC-3**: A wrong email, a wrong password, or correct credentials for a user who is not an active admin all show the same message, "Email or password is incorrect.", and leave no session behind. A malformed email or an empty field shows field errors without calling Supabase. A Supabase rate limit shows "Too many attempts. Wait a minute and try again." and an Auth outage shows "Sign in is unavailable right now. Try again shortly." (the fixed strings in *Messages*).
- **AC-4**: An active admin with no verified TOTP factor who passes the password step sees a "Set up authenticator" button on `/admin/mfa`. Pressing it shows a QR code, the same secret as grouped text, and a code field. A correct code verifies the factor and opens the panel as in AC-2. A wrong code (in the enroll or the verify view) shows "That code is incorrect. Try the current code from your app." and retries reuse the same factor, so reloading or retrying never invalidates a QR code already scanned. Leftover unverified factors are removed only when the button is pressed. The MFA page always offers Sign out. A session that came from a reset link (its `amr` contains `recovery` or `otp`) never sees the enroll view: with no verified factor it shows "Your authenticator is not set up. Contact the store owner."
- **AC-5**: A session that has passed only the password step (Supabase assurance level `aal1`) cannot open any `/admin` page or run any admin action except the `/admin/mfa` step. Pages redirect it to `/admin/mfa?next=<path>`; actions do nothing and redirect the same way.
- **AC-6**: A signed in user with no `admin_users` row, or whose row has `disabled_at` set, gets a 404 on every `/admin` page and every admin action, with no hint that the panel exists. Setting `disabled_at` takes effect on that admin's next request.
- **AC-7**: When 12 hours have passed since a session signed in (the earliest `amr` timestamp in its token), the next `/admin` request ends that session on this device and redirects to `/admin/sign-in` with "Your session has expired. Please sign in again."
- **AC-8**: Sign out in the user menu ends the session on this device only (Supabase `scope: 'local'`) and shows `/admin/sign-in` with "You have signed out." Pressing Back afterwards shows no admin content, and sessions on other devices keep working.
- **AC-9**: `/admin/forgot-password` accepts an email and always shows "If that email belongs to an admin, a reset link is on its way." A reset email is sent only when the email matches an active admin. The link opens `/auth/confirm`, which shows a "Continue" button (so email link scanners that open the link cannot use it up); pressing it verifies the link, then asks for the TOTP code, then shows `/admin/reset-password`. Saving a valid new password signs out the admin's other sessions and lands them on `/admin`. A used, expired or tampered link lands on `/admin/sign-in` with "That link is invalid or has expired. Request a new one."
- **AC-10**: Supabase enforces passwords of at least 8 characters with lower case, upper case, digits and symbols. The reset page checks the same rule with the shared Zod schema and names each missing part, and shows "Choose a password you have not used here before." when Supabase answers `same_password`. Public sign up is off in `supabase/config.toml` and in the production project.
- **AC-11**: `pnpm admin:create --email <e> --name <n>` prompts twice for a hidden password that must meet AC-10, creates a confirmed Supabase auth user and the `admin_users` row, and prints the admin id. If an auth user with that email already exists (for example a future customer), it keeps that user and password, marks the email confirmed, and adds the `admin_users` row, or re-enables it and updates the name if it exists. `pnpm admin:disable --email <e>` sets `disabled_at`. `pnpm admin:reset-mfa --email <e>` deletes the admin's TOTP factors and all their sessions, so every device is signed out and they enroll again at their next sign in. Emails are stored in lower case.
- **AC-12**: `next` is honored only when it is a relative path starting with `/admin` (not `//`, no backslash, no scheme, not an auth page). Anything else falls back to `/admin`, so the sign in flow cannot become an open redirect.
- **AC-13**: Sign in success, sign in failure, MFA success, MFA failure, MFA enrollment, sign out, session expiry, 404 denial, reset requested and password changed are each logged as one pino event with the admin id when known, a SHA-256 hash of the lower cased email otherwise, and the client IP. No password, code, secret, token or cookie is ever logged.
- **AC-14**: Every auth page (`sign-in`, `mfa`, `forgot-password`, `reset-password`) works by keyboard alone, labels every field, links errors to their field and announces form level errors, and axe reports zero violations on desktop and phone viewports (same tags as spec 0003 AC-9). The TOTP secret is readable as text, so a screen reader user can enroll without the QR code.
- **AC-15**: Production has a Vercel Firewall rate limit rule on `POST` requests to `/admin/sign-in`, `/admin/mfa` and `/admin/forgot-password`: 10 per minute per IP, then deny for 10 minutes. The runbook records it. This is checked at deploy time, in scope feature 19 (Production deploy), not when this feature is verified: until then the app runs only in local dev, where there is no Vercel Firewall.
- **AC-16**: After 5 wrong TOTP codes for one factor within 15 minutes (counted on the server across all sessions and IPs), the next attempt signs the session out on this device and shows `/admin/sign-in` with "Too many incorrect codes. Please sign in again." Until the window passes, every further code attempt for that factor is refused the same way.
- **AC-17**: A signed in visitor who opens `/admin/sign-in` or `/admin/forgot-password` is sent on: an active admin at `aal1` to `/admin/mfa`, an active admin at `aal2` to the validated `next` or `/admin`. Anyone else sees the page as normal.

## Decision

**Chosen option**: Option 1: Supabase Auth password plus required TOTP, admin role from the `admin_users` table checked on every request.

Admins sign in through server actions that call Supabase Auth. A second TOTP step is required before any admin page or action runs. `requireAdmin()` confirms the user with the Auth server, reads the assurance level and sign in time from the token, and loads the live `admin_users` row on every call.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`)

**Decisions made in the design conversation** (fixed inputs):
- Method: email and password. MFA: TOTP, required for every admin. Lost authenticator: `pnpm admin:reset-mfa`.
- Accounts: created by `pnpm admin:create`, no invite email and no admin UI. Public sign up off until feature 12.
- Forgot password: self serve email through Supabase, sent by Resend SMTP configured in the Supabase dashboard now (Mailpit locally).
- Session: app enforced 12 hour cap. Sign out ends this device only.
- Not an active admin: 404. After sign in: back to a validated `next`, else `/admin`.
- Sign in runs in a server action, with a Vercel Firewall rule for per IP limits.
- Passwords: at least 8 characters with all four character classes.
- One auth user may be both an admin and a customer.
- No schema change. Audit trail: pino logs plus Supabase's own auth audit log.
- Routes live under `/admin` outside the shell, plus `/auth/confirm`. Proxy only on `/admin` and `/auth`.
- e2e codes from the `otpauth` dev dependency. Agent skills for `otpauth` were offered and declined (none credible).

**Decisions made while writing** (each with its runner up):
- **User check**: `requireAdmin()` calls `supabase.auth.getUser()`, which asks the Auth server, so a signed out, revoked or deleted session fails at once. It then reads `aal` and the `amr` timestamps from `mfa.getAuthenticatorAssuranceLevel()` (`currentLevel`, `currentAuthenticationMethods`), which decodes the already verified token locally with no second network call. The proxy uses only `getClaims()`, because it runs on every admin request and only refreshes and gates. Runner up: `getClaims()` everywhere, which checks the token locally with no network hop but trusts a revoked session until its token expires (up to 1 hour).
- **One guard, one pure core**: `decideAdminAccess(input)` is a pure function returning `allow | sign-in | mfa | not-found` (plus an `expired` reason). `requireAdmin()` feeds it and turns the verdict into `redirect()` or `notFound()`, which Next.js supports in pages, layouts, server actions and route handlers. So every admin entry point calls the same `requireAdmin()`. The MFA step and `signOut` call `requireAdmin({ allowAal1: true })`, which turns the `mfa` verdict into `allow` (see the verdict table). Runner up: separate guards for pages and actions, which is more code for the same verdict.
- **Session age**: measured from the earliest timestamp in the `amr` list (the moment of the first factor). Supabase carries `amr` across token refreshes, and a later TOTP verify bumps only the `totp` entry, never the first factor's, so neither refreshing nor verifying again resets the cap (a unit test pins this). The limit is a constant, `ADMIN_SESSION_MAX_AGE_SECONDS = 43_200`, in the feature (not an env var). Runner up: the `totp` entry's timestamp, which moves on every verify and would let the cap be extended.
- **Where expiry signs out**: the proxy, because a Server Component cannot write cookies. The proxy checks session age on every `/admin` request and calls `signOut({ scope: 'local' })`. For a normal page request it redirects with `reason=expired`, copying the cleared cookies and `Cache-Control: no-store` onto the redirect response (a fresh `NextResponse.redirect` drops them otherwise). For a server action request (it carries the `Next-Action` header) it only clears the cookies and lets the request through, because a proxy redirect answering an action POST breaks the client; `requireAdmin()` inside the action then redirects. `requireAdmin()` repeats the age check everywhere in case the proxy misses a path. A disabled or non admin user is not signed out; their session is harmless because every request checks the row, and it dies at the 12 hour cap. Runner up: a GET sign out route that pages redirect to, which invites logout CSRF (a third party page signing the admin out).
- **Non admin with valid credentials at the sign in form**: the action calls `signOut({ scope: 'local' })` at once (never the default `global`, which would end a future customer's sessions on every device) and shows the AC-3 message, so the form cannot be used to test whether an account is an admin.
- **Reset link flow**: the token hash pattern, with a fixed template. The recovery email template hard codes its link as `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`, so it never depends on `redirectTo` matching the allow list. `/auth/confirm` accepts only `type=recovery` and ignores any `next`. Its GET renders a small page with a "Continue" button (the token in hidden fields); only the POST calls `verifyOtp({ type: 'recovery', token_hash })`, then redirects to `/admin/mfa?next=/admin/reset-password`. The GET step exists because corporate link scanners (for example Outlook Safe Links) open links before the person does, and a GET that verified would burn the one time token. Runner up: the PKCE code exchange (`exchangeCodeForSession`), which fails when the link is opened in a different browser than the one that asked for it.
- **Requesting the reset**: `requestPasswordReset` sends through a separate, stateless Supabase client (`createClient` with `auth: { persistSession: false, flowType: 'implicit' }`), because the `@supabase/ssr` client defaults to PKCE and would try to set a code verifier cookie from inside `after()`, when the response is already sent.
- **Reset requires TOTP**: `/admin/reset-password` requires `aal2`, so an attacker who controls only the admin's inbox cannot change the password. A reset session can only verify an existing factor, never enroll one (AC-4), which closes the path for an admin with no factor yet. After `updateUser({ password })`, the action calls `signOut({ scope: 'others' })`. Runner up: allowing the change at `aal1`, which makes the inbox alone enough to take over the password.
- **Enrollment**: the enroll view is started by the "Set up authenticator" button, never on page render (a reload, prefetch or second tab would otherwise replace a QR code already scanned). `enrollTotp` first unenrolls unverified factors from `mfa.listFactors()`, then calls `mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator', issuer: brand.name })`, and returns the QR code and secret for the client to keep showing across wrong code retries. The QR code is the SVG `totp.qr_code` shown in an `<img>` with alt text; the secret is shown as text in groups of four. It refuses when the session `amr` contains `recovery` or `otp`.
- **Factor lookup is server side**: `verifyTotp` takes only the code. It finds the factor itself with `mfa.listFactors()`: the verified TOTP factor if one exists, else the single unverified one. It never trusts a factor id from the browser. It verifies with `mfa.challengeAndVerify`.
- **Wrong code limit (AC-16)**: before verifying, `verifyTotp` counts that factor's unverified challenges from the last 15 minutes with a read only `prisma.$queryRaw` on `auth.mfa_challenges` (`factor_id`, `created_at`, `verified_at IS NULL`). Each `challengeAndVerify` call creates one challenge row, so the count is per account, not per IP or per session. At 5 or more it signs out locally and redirects with `reason=too_many_codes`. Runner up: a counter cookie, which an attacker simply deletes. Tradeoff: this reads a Supabase internal table whose shape Supabase could change; an integration test against the local stack pins the columns.
- **Messages**: every user facing string lives in one `messages.ts` in the feature, and query params map to them by key (never echoed raw):

  | Key | Text |
  |---|---|
  | `invalid_credentials` | Email or password is incorrect. |
  | `rate_limited` (Supabase `over_request_rate_limit`, `over_email_send_rate_limit`, HTTP 429) | Too many attempts. Wait a minute and try again. |
  | `unavailable` (Supabase 5xx or network error) | Sign in is unavailable right now. Try again shortly. |
  | `invalid_code` | That code is incorrect. Try the current code from your app. |
  | `too_many_codes` | Too many incorrect codes. Please sign in again. |
  | `mfa_not_set_up` | Your authenticator is not set up. Contact the store owner. |
  | `expired` | Your session has expired. Please sign in again. |
  | `signed_out` | You have signed out. |
  | `invalid_link` | That link is invalid or has expired. Request a new one. |
  | `reset_sent` | If that email belongs to an admin, a reset link is on its way. |
  | `same_password` | Choose a password you have not used here before. |
  | `mismatch` | The passwords do not match. |
  | password rule parts | At least 8 characters · A lower case letter · An upper case letter · A digit · A symbol |
  | field errors | Enter your email address · Enter a valid email address · Enter your password · Enter the 6 digit code |
- **Page structure**: `app/admin/(auth)/` holds `sign-in`, `mfa`, `forgot-password` and `reset-password` with a plain centered layout (no shell). `app/admin/(panel)/layout.tsx` wraps `AdminShell` and the user menu, and `app/admin/(panel)/page.tsx` is the welcome page. Layouts do not re-run on every client navigation, so each panel page and each admin action also calls `requireAdmin()`, and the layout call only feeds the user menu. `adminNavItems` stays empty; feature 15 adds the dashboard.
- **Auth pages with a session (AC-17)**: `sign-in` and `forgot-password` call a light `redirectIfSignedIn(next)` helper that runs the same `decideAdminAccess` and redirects only on `mfa` or `allow`; any other verdict renders the page.
- **All admin routes are dynamic, and Back shows nothing**: they read cookies, so Next.js renders them per request. The proxy sends `Cache-Control: no-store` on every `/admin` response, redirects included. `signOut` redirects with `redirect(url, RedirectType.replace)`, so the panel page is replaced in history rather than pushed over. An e2e test presses Back after sign out and asserts no admin text; if the router cache still restores it, the sign out form falls back to a full page navigation (`location.replace`).
- **Email match for reset**: the forgot action looks up `admin_users` by lower cased email with `disabled_at IS NULL` and only then calls `resetPasswordForEmail`. The response and its timing path are the same either way (the Supabase call is not awaited in the reply path; it runs in `after()`). Runner up: always calling Supabase, which would also send the admin template to future customers.
- **Scripts**: `scripts/admin/{create,disable,reset-mfa}.ts`, run with `tsx` and wired as `admin:*` package scripts. They build their own Prisma client and a Supabase service role client the way `scripts/test-db.ts` builds its client, and never import `server-only` modules. They share only the pure `passwordSchema` from the feature. An existing auth user is found with `prisma.$queryRaw` on `auth.users` by lower cased email (read only; Prisma still manages nothing in `auth`). `create` on an existing auth user calls `auth.admin.updateUserById(id, { email_confirm: true })` and upserts the `admin_users` row (name updated, `disabled_at` cleared). `reset-mfa` deletes each factor with `auth.admin.mfa.deleteFactor`, then deletes that user's rows in `auth.sessions` with `prisma.$executeRaw`, which revokes every refresh token (the only write to `auth` anywhere, and only from this script). To run against production, use env pulled with `vercel env pull`.
- **Enrollment window, accepted**: between `admin:create` (or `admin:reset-mfa`) and that admin's first sign in, whoever holds the password can enroll the factor. That is acceptable because you hand the password over directly and the admin signs in soon after; the runbook says so. Runner up: enrolling the factor from the script and printing the QR code in the terminal, which needs the admin at your terminal.
- **Logging**: this feature adds `src/lib/logger.ts` (pino, JSON to stdout, which Vercel captures), the first use of the logger from spec 0001, with pino `redact` on `password`, `code`, `secret`, `token`, `token_hash`, `cookie`, `authorization` at any depth. The events, each once, are `auth.sign_in.succeeded`, `auth.sign_in.failed` (with `reason`: `invalid_credentials`, `not_admin`, `rate_limited`, `unavailable`), `auth.mfa.enrolled`, `auth.mfa.succeeded`, `auth.mfa.failed`, `auth.mfa.locked`, `auth.sign_out`, `auth.session.expired`, `auth.access.denied`, `auth.reset.requested` (with `sent`: true or false), `auth.password.changed`. The IP is the first `x-forwarded-for` entry (set by Vercel), else `null`. The email hash is an unsalted SHA-256, accepted: it only correlates repeated attempts, and emails are guessable either way.
- **CI runs real Supabase for e2e**: the e2e job runs `pnpm exec supabase start` with unused services excluded (`studio`, `realtime`, `storage-api`, `imgproxy`, `edge-runtime`, `logflare`, `vector`, `supavisor`), runs `pnpm exec prisma migrate deploy` against the local database (`supabase start` does not apply Prisma migrations), and maps `supabase status -o env` output (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`) onto `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` before `pnpm build`, since `NEXT_PUBLIC_*` values are baked in at build time. Mailpit stays on for the reset test. The local `[auth.rate_limit]` values (`sign_in_sign_ups`, `token_verifications`, `email_sent`) are raised in `config.toml` so desktop plus phone projects do not trip them. Every test creates its own admin with a unique email, and the code helper waits for a fresh 30 second TOTP step when fewer than 5 seconds remain. Runner up: mocking Supabase Auth in e2e, which would test nothing that matters here.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**: no schema change. This feature reads what exists:

| Table | Owner | Used for |
|---|---|---|
| `admin_users` (id = auth uuid, email unique, name, disabled_at?) | app, spec 0002 | admin authority: a row with `disabled_at IS NULL` |
| `auth.users` | Supabase | identity, password, email confirmation; read only by the create script |
| `auth.mfa_factors` | Supabase | TOTP factors, via the Auth API only |
| `auth.sessions`, `auth.audit_log_entries` | Supabase | sessions and Supabase's own audit trail |

**State transitions** (one admin session):

```
no session ──password ok + active admin──▶ aal1 ──TOTP ok──▶ aal2 (panel open)
    ▲                                        │                  │
    │                                        │ no factor        ├──sign out──────────▶ no session (this device)
    │                                        ▼                  ├──12h since sign in──▶ no session (proxy signs out)
    │                                  enroll TOTP ──ok──▶ aal2 ├──disabled_at set────▶ 404 on every request
    │                                  (never from a reset link)
    ├──── 5 wrong codes in 15 min on this factor (from aal1) ──▶ no session (this device)
    └──── reset link (aal1, recovery) ──TOTP──▶ aal2 ──new password──▶ other sessions ended
```

**API surface** (server actions and routes; every input validated with Zod):

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/admin/sign-in` | page | `next?`, `reason?` (a message key from *Messages*: `expired`, `signed_out`, `invalid_link`, `too_many_codes`) | form, reason message | public | none |
| `signIn` | action | email (req), password (req), next (opt) | redirect to `/admin/mfa?next=` | public, Firewall limited | `invalid_credentials` (bad email, bad password, not an admin), `rate_limited`, `unavailable`, field errors |
| `/admin/mfa` | page | `next?` | verify view, "Set up authenticator" button, or `mfa_not_set_up` message; always a Sign out button | `requireAdmin({ allowAal1: true })`; `aal2` goes on to `next` | per the verdict table |
| `enrollTotp` | action | none | QR SVG, secret | `requireAdmin({ allowAal1: true })`, `amr` without `recovery`/`otp` | `mfa_not_set_up`, `rate_limited`, `unavailable` |
| `verifyTotp` | action | code (req, 6 digits), next (opt) | redirect to `next` or `/admin` | `requireAdmin({ allowAal1: true })`, Firewall limited | `invalid_code`, `too_many_codes` (signs out), `rate_limited`, `unavailable` |
| `signOut` | action | none | `redirect('/admin/sign-in?reason=signed_out', RedirectType.replace)` | `requireAdmin({ allowAal1: true })`, or any session | none |
| `/admin/forgot-password` | page | none | form | public | none |
| `requestPasswordReset` | action | email (req) | the fixed confirmation message | public, Firewall limited | field errors only |
| `/auth/confirm` | route handler, GET | token_hash, type (must be `recovery`) | a page with a "Continue" button posting both back | public | other `type` or missing token → `/admin/sign-in?reason=invalid_link` |
| `/auth/confirm` | route handler, POST | token_hash, type=`recovery` (form fields) | `verifyOtp`, then redirect to `/admin/mfa?next=/admin/reset-password` | public | bad, used or expired token → `/admin/sign-in?reason=invalid_link` |
| `/admin/reset-password` | page | none | form | `aal2`, active admin | `aal1` → `/admin/mfa?next=/admin/reset-password` |
| `resetPassword` | action | password (req), confirm (req) | redirect `/admin` | `aal2`, active admin | password rule parts, `same_password`, `mismatch`, `unavailable` |
| `/admin` | page | none | "Signed in as <name>" | `requireAdmin()` | redirect or 404 per `decideAdminAccess` |
| `proxy.ts` | proxy | request cookies | refreshed cookies, redirects, `no-store` | none (first gate only) | none |
| `requireAdmin()` | server function | none | `{ id, email, name }` | the check itself | `redirect()` or `notFound()` |
| `pnpm admin:create` / `admin:disable` / `admin:reset-mfa` | scripts | `--email`, `--name`, hidden password prompt | admin id or a done line | service role key + DB URL | unknown email, weak password, passwords differ |

**`decideAdminAccess` verdicts** (pure, unit tested; checked in this order):

| Input state | Verdict |
|---|---|
| no verified user | `sign-in` |
| session age over 12 hours | `sign-in` with reason `expired` |
| no `admin_users` row, or `disabled_at` set | `not-found` |
| `aal` is `aal1` | `mfa` (with `allowAal1: true`: `allow`) |
| otherwise | `allow` with the admin |

The MFA page adds one step after `allow`: at `aal2` it redirects to the validated `next` or `/admin` instead of rendering.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `requireAdmin` | user id | `getUser()`, confirmed by the Auth server |
| `requireAdmin` | assurance level | `getClaims().claims.aal` |
| `requireAdmin`, proxy | session start | the earliest `timestamp` in `getClaims().claims.amr` |
| `requireAdmin`, proxy | now | server clock (`Date.now()`), injected into the pure function |
| `requireAdmin`, proxy | 12 hour limit | constant `ADMIN_SESSION_MAX_AGE_SECONDS` in `src/features/admin-auth/` |
| `requireAdmin` | active admin, name, email | `admin_users` row by id, `disabled_at IS NULL` |
| `signIn` | whether to open the MFA step | Supabase password result, then the `admin_users` row for that user id |
| `signIn`, `verifyTotp` | redirect target | `next` input, checked by `safeAdminPath()` (AC-12), else `/admin` |
| `/admin/mfa` | enroll or verify view | `mfa.listFactors()`: a verified `totp` factor means verify; none plus a reset session (`amr` has `recovery` or `otp`) means `mfa_not_set_up`; else the setup button |
| `verifyTotp` | which factor | `mfa.listFactors()` on the server: the verified TOTP factor, else the single unverified one |
| `verifyTotp` | wrong codes so far | unverified rows in `auth.mfa_challenges` for that factor in the last 15 minutes (`prisma.$queryRaw`) |
| `/auth/confirm` POST | token, type | the form fields its own GET page rendered from the email link |
| `enrollTotp` | QR code, secret | `mfa.enroll()` response (`totp.qr_code`, `totp.secret`) |
| `enrollTotp` | issuer shown in the app | `brand.name` from `src/lib/brand/` |
| `requestPasswordReset` | whether to send | `admin_users` by lower cased email, `disabled_at IS NULL` |
| `requestPasswordReset` | link target | the recovery template: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` (Site URL = the Supabase project setting, which matches `NEXT_PUBLIC_SITE_URL`) |
| `resetPassword` | password rule | shared `passwordSchema` mirroring the Supabase policy (AC-10) |
| sign in page | reason message | `reason` query param, mapped to fixed strings (never echoed raw) |
| user menu, welcome page | name, email | `admin_users` row returned by `requireAdmin()` |
| log events | admin id / email hash / IP | the user id when known; `sha256(lowercase email)` otherwise; first `x-forwarded-for` entry, else `null` |
| `admin:create` | email, name | `--email`, `--name` flags; email lower cased |
| `admin:create` | password | hidden prompt, entered twice, checked with `passwordSchema` (never a flag, so it stays out of shell history) |
| `admin:create` | existing auth user | `auth.users` by lower cased email via `prisma.$queryRaw` |

**Key invariants**:
- Admin authority comes only from a live `admin_users` row, checked on every request. Never from `user_metadata`, a claim or the proxy.
- No admin page or action runs below `aal2`, except the MFA step and sign out.
- A session that came from a reset link can verify an existing factor but never enroll one.
- The TOTP factor used for verification is always looked up on the server.
- Every admin page, action and route handler calls `requireAdmin()` itself. The proxy and layouts are conveniences, not the check.
- A session older than 12 hours from its first factor never opens an admin page.
- Every denial of a non admin looks the same as a missing page (404), and every failed sign in looks the same whatever the cause.
- `next` never leaves the `/admin` path space.
- Passwords, TOTP codes, secrets, tokens and cookies are never logged or echoed back.
- The service role key is used only in `server-only` code and in the `scripts/admin/*` scripts.
- The app reads Supabase's `auth` schema (`auth.users` in scripts, `auth.mfa_challenges` in `verifyTotp`) but writes to it only in `admin:reset-mfa` (deleting `auth.sessions` rows).

**Security model**:
- Roles: one role, admin. An admin can do everything in `/admin`. There is no public sign up, and admins are created only by someone holding the production service role key.
- Two factors: something known (password) plus something held (the TOTP device). Rate limits apply per IP at the Vercel Firewall, per factor for TOTP guesses (AC-16), plus Supabase's own limits on sign in and token checks (shared across all admins, since calls come from Vercel's servers).
- Enumeration: the sign in, MFA and forgot password responses do not reveal whether an email exists or is an admin.
- Sessions: `@supabase/ssr` HTTP only cookies, refreshed by the proxy, capped at 12 hours, ended per device on sign out. A password reset ends every other session.
- Compliance: admin emails and names are personal data (GDPR). They are logged only as an id or hash. The client IP is personal data too; it is logged for security (spotting and blocking attacks on the panel, a legitimate interest) and kept only as long as Vercel keeps logs. No new personal data is stored in the database.

**Configuration required** (no new env vars; settings, not code):
- `supabase/config.toml`: `[auth] enable_signup = false` and `[auth.email] enable_signup = false`; `minimum_password_length = 8`; `password_requirements = "lower_upper_letters_digits_symbols"`; `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true`; `site_url = "http://localhost:3000"`; `additional_redirect_urls = ["http://localhost:3000/**"]`; `[auth.email.template.recovery]` with `content_path = "./supabase/templates/recovery.html"`; `[auth.rate_limit]` `sign_in_sign_ups`, `token_verifications` and `email_sent` raised for local and CI test runs.
- Production Supabase project (dashboard): the same auth settings; Site URL set to the production domain (reset links always point there, so a reset started on a preview deploy lands on production; previews test reset only locally); the recovery template; custom SMTP pointing at Resend (host, port, user `resend`, the Resend API key as password, sender on a domain verified in Resend); asymmetric JWT signing keys on, so `getClaims()` verifies locally.
- Vercel Firewall: the AC-15 rate limit rule.
- Existing env vars reused: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (scripts only), `NEXT_PUBLIC_SITE_URL`, `DATABASE_URL`.
- New dependencies, pinned: `@supabase/ssr`, `@supabase/supabase-js`, `pino`; dev: `otpauth`.

**Critical test scenarios**:
- Happy path: the seeded admin signs in, enrolls TOTP with a code from `otpauth`, lands on `/admin` and sees their name, signs out, then signs in again and verifies with a fresh code, verifies **AC-2**, **AC-4**, **AC-8**
- Failure case: a wrong password, an unknown email, and a customer's valid credentials all produce the identical message and no session cookie, verifies **AC-3**
- Failure case: a session with `aal1` requesting `/admin` and posting an admin action is redirected to `/admin/mfa`, verifies **AC-5**
- Failure case: `decideAdminAccess` unit tests cover each verdict and the boundaries (exactly 12h, 12h plus 1s, disabled, `aal1`), verifies **AC-5**, **AC-6**, **AC-7**
- Failure case: `safeAdminPath` rejects `//evil.test`, `/\evil.test`, `https://evil.test`, `/admin-evil`, `/admin/sign-in`, and accepts `/admin/orders/1?x=y`, verifies **AC-12**
- Failure case: the reset link from Mailpit shows Continue, asks for TOTP, then sets a new password; a plain GET of the link verifies nothing; using the same link again shows the invalid link message, verifies **AC-9**
- Failure case: an admin with no factor who follows a reset link sees `mfa_not_set_up` and no setup button, and `enrollTotp` refuses for that session, verifies **AC-4**
- Failure case: a wrong code, then a reload, then the right code from the QR already scanned still enrolls (the factor is reused), verifies **AC-4**
- Failure case: 5 wrong codes then a sixth attempt signs out with `too_many_codes`, and a new sign in within 15 minutes is still refused at the MFA step, verifies **AC-16**
- Failure case: after sign out, pressing Back shows no admin text, verifies **AC-8**
- Failure case: re-verifying TOTP does not move the session start (earliest `amr` timestamp) in a unit test, verifies **AC-7**
- Auth/permission: a signed in non admin and a just disabled admin get 404 on `/admin` and on an admin action, verifies **AC-6**
- Auth/permission: a signed out visitor to `/admin/anything` is redirected to sign in with `next`, and `/` makes no Supabase call, verifies **AC-1**
- Auth/permission: a signed in admin at `aal2` opening `/admin/sign-in` goes to `/admin`; at `aal1` goes to `/admin/mfa`, verifies **AC-17**

## Build plan

Tracer Bullet: task 1 threads one real path (config, clients, proxy, script, action, guard, page, e2e in CI against a real local Supabase), password only. Each later task thickens that path. Tasks 1 to 3 together make the first safe state: do not merge or deploy before task 2, because until then the panel opens at `aal1`.

1. **Thin thread**: install and pin `@supabase/ssr`, `@supabase/supabase-js`, `pino`; add `src/lib/supabase/server.ts` (the cookie based server client, `server-only`) and `src/lib/logger.ts`; add `proxy.ts` with matcher `['/admin/:path*', '/auth/:path*']` that refreshes via `getClaims()`, redirects signed out visitors per AC-1, and sets `no-store`; update `supabase/config.toml` auth settings (sign up off, password policy, TOTP on, redirect URLs); add `scripts/admin/create.ts` and the `admin:create` script; add `src/features/admin-auth/` with `passwordSchema`, `signInSchema`, `safeAdminPath`, `decideAdminAccess` (all verdicts), `requireAdmin()`, and the `signIn` and `signOut` actions; add `app/admin/(auth)/sign-in/page.tsx`, `app/admin/(panel)/layout.tsx` (shell plus user menu) and `app/admin/(panel)/page.tsx`; move CI e2e onto `supabase start` plus `prisma migrate deploy`, with keys mapped from `supabase status -o env` before the build and raised local auth rate limits; add a Playwright fixture that creates a uniquely named admin per test through the Supabase admin API and Prisma; `signOut` with `RedirectType.replace`, the proxy copying cookies and `no-store` onto redirects and skipping redirects for server action requests; the `messages.ts` table; e2e: sign in, see the name, sign out, press Back and see no admin text. satisfies **AC-1**, **AC-2**, **AC-3**, **AC-8**, **AC-11**
2. **Required TOTP**: `requireAdmin({ allowAal1 })` and `aal2` enforcement in `decideAdminAccess`; `/admin/mfa` with the verify view, the setup button, the enroll view and a Sign out button, redirecting on at `aal2`; `enrollTotp` (cleanup inside it, refused for reset sessions) and `verifyTotp` (server side factor lookup, the `auth.mfa_challenges` wrong code count and lockout); `signIn` now redirects to the MFA step; `redirectIfSignedIn` on the sign in page; `scripts/admin/reset-mfa.ts` (factors and sessions); add `otpauth` and extend the fixture to enroll a factor and generate codes that avoid the last 5 seconds of a step; an integration test pinning the `auth.mfa_challenges` columns; e2e for first enrollment, reload then enroll with the same QR, later verify, wrong code, the lockout, and `aal1` blocked from a page and an action. satisfies **AC-2**, **AC-4**, **AC-5**, **AC-11**, **AC-16**, **AC-17**
3. **Denials and session cap**: the non admin sign out in `signIn`; 404 for non admins and disabled admins; the 12 hour cap in the proxy (sign out plus redirect) and in `requireAdmin()`; `safeAdminPath` wired into every redirect; the sign in page reason messages; `scripts/admin/disable.ts`; the `decideAdminAccess` and `safeAdminPath` unit tests; e2e for the 404 cases. Expiry is covered by unit tests of `decideAdminAccess` and of the proxy's expiry branch called with an injected `now`, because Playwright cannot move the server's clock. satisfies **AC-3**, **AC-6**, **AC-7**, **AC-11**, **AC-12**
4. **Password reset**: `supabase/templates/recovery.html` with the fixed `{{ .SiteURL }}` token hash link; `/admin/forgot-password` (with `redirectIfSignedIn`) and `requestPasswordReset` (admin lookup, the fixed reply, send in `after()` through the stateless implicit flow client); `/auth/confirm` GET (Continue page, `type=recovery` only) and POST (`verifyOtp`); the `mfa_not_set_up` path for reset sessions without a factor; `/admin/reset-password` and `resetPassword` (requires `aal2`, `passwordSchema`, `signOut({ scope: 'others' })`); e2e that reads the email from Mailpit's API, checks a plain GET verifies nothing, completes the reset with TOTP, reuses the link to see the invalid link message, and covers the unenrolled admin case. satisfies **AC-4**, **AC-9**, **AC-10**, **AC-17**
5. **Logging and accessibility**: emit the listed `auth.*` events from every action, the proxy and `requireAdmin()`; a unit test that pino `redact` hides every listed key at any depth; keyboard and axe e2e on the four auth pages at desktop and phone, including error states and the enroll view. satisfies **AC-13**, **AC-14**
6. **Production runbook**: `docs/runbooks/admin-accounts.md` covering the production Supabase auth settings, Resend SMTP, the recovery template, redirect URLs, asymmetric JWT keys, the Vercel Firewall rule, creating the first admin with `vercel env pull` plus `pnpm admin:create`, the enrollment window (hand the password over directly and have the admin sign in soon), disabling an admin, recovering a lost authenticator, and the note that reset links always point at the production Site URL. This feature only writes the runbook. Applying the settings and the Firewall rule to production and creating the first real admin happen at deploy, in scope feature 19 (Production deploy), which is where AC-15 is checked. satisfies **AC-10** (runbook), **AC-15** (at deploy)

## Consequences

**Positive**:
- A stolen or guessed password alone opens nothing; the refunds and catalog edits coming in features 9 and 10 sit behind two factors.
- Disabling an admin works on their very next request, because authority is read from the database every time.
- No admin UI for accounts means no screen to attack or build; the scripts are the whole account lifecycle.
- The pure `decideAdminAccess` puts every access rule in one tested function, which every later admin feature inherits by calling `requireAdmin()`.
- The same Supabase session plumbing (`@supabase/ssr`, proxy, confirm route, SMTP) is ready for customer accounts in feature 12.

**Negative / tradeoffs**:
- Every admin request makes one call to the Supabase Auth server (`getUser()`) and one DB query. Fine for a few admins; it would matter only at a scale this panel will not see.
- Sign in calls come from Vercel's servers, so Supabase's per IP limit is shared by all admins. Someone hammering the form could briefly block real admins until the Firewall rule cuts them off. The Firewall rule is the real per IP guard, and it lives outside the repo (the runbook records it).
- Admins sign in with a code at least once a day. That is deliberate, but it is friction.
- A lost phone needs you at a terminal with production credentials. There are no self serve recovery codes.
- Password reset depends on Resend SMTP being set up in Supabase before launch; until then, only the scripts can recover an admin.
- Until feature 19 applies the Firewall rule, nothing limits sign in attempts per IP except Supabase's shared limit. That is fine while the app runs only in local dev, and it is why the rule must be live before the first production admin is created.
- Production auth settings live in the Supabase dashboard, not in code, so they can drift from `config.toml`. The runbook is the only record.
- The wrong code limit and `admin:reset-mfa` touch Supabase's internal `auth` tables (`mfa_challenges`, `sessions`), which Supabase could reshape in an upgrade. An integration test pins the columns, but a Supabase upgrade can still break them.
- Someone who knows an admin's password can lock that admin out of the MFA step for 15 minutes by entering wrong codes. That is the price of a per account limit, and it tells you the password has leaked.
- CI e2e now boots a local Supabase stack, which makes the pipeline slower (Docker image pulls on each run unless cached).

**Neutral**:
- A disabled admin keeps a useless session cookie until the 12 hour cap; every request with it gets a 404.
- The logger arrives with this feature; later features reuse `src/lib/logger.ts`.
- Feature 12 must turn public sign up back on and widen the proxy matcher, and must keep the admin check independent of any customer session state.

## Follow-up

- [ ] `/sync`: record `otpauth` agent skills as declined in root `AGENTS.md` (none credible found; offered on 2026-09-25).
- [ ] `/sync`: once built, add an `src/features/admin-auth/AGENTS.md` (or root `## Rules` line) noting that `requireAdmin()` also enforces `aal2` and the 12 hour cap, so later admin features do not add their own checks.
- [ ] Spec 0001 Follow-up "Feature 5 decides where the admin role lives and the shape of `requireAdmin()`" is settled here; spec 0002 Follow-ups on `requireAdmin()`, the first admin row, and "one auth user may hold both rows" (confirmed: allowed) are settled here.
- [ ] Feature 12 (customer accounts): turn public sign up back on, widen the proxy matcher to account routes, and give customer password reset its own template path (the recovery template is shared, so the `next` in `redirectTo` must decide where the link lands).
- [ ] Feature 19 (Production deploy): apply the runbook to production (Supabase auth settings, Resend SMTP, recovery template, redirect URLs, JWT keys), turn on the Vercel Firewall rule and check AC-15, then create the first real admin. Added to the scope on 2026-09-25.
- [ ] Feature 11 (order emails) reuses the Resend domain verified here for Supabase SMTP.
- [ ] If an admin management screen is ever wanted, it needs its own spec (invites, roles, audit of admin changes).
