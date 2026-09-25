# Verify: admin sign in · spec 0004 · updated 2026-09-25
_Steps derived from spec 0004 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Setup: `pnpm db:start` (restart it once after pulling, so the new `supabase/config.toml` auth settings apply), `pnpm dev`, then `pnpm admin:create --email you@example.com --name "You"`. Mailpit is at http://127.0.0.1:55324.

## UI / manual
- [ ] Signed out, open `/admin/orders?status=paid` → redirected to `/admin/sign-in?next=%2Fadmin%2Forders%3Fstatus%3Dpaid` → AC-1
- [ ] Open `/` → no `sb-` cookie set, and the dev log shows no `proxy.ts` time for `/` → AC-1
- [ ] Sign in with the new admin → `/admin/mfa` shows "Set up authenticator"; press it → QR code plus the key in groups of four; scan, type the code → `/admin` shows "Signed in as You"; the top bar menu shows name, email and Sign out → AC-2, AC-4
- [ ] Sign out from the menu → `/admin/sign-in` with "You have signed out."; press Back → no admin text → AC-8
- [ ] Sign in again → verify view (no setup button); a correct code → `/admin` → AC-2
- [ ] Wrong password, unknown email, and a non admin auth user's real password → each shows "Email or password is incorrect.", no `sb-` cookie remains → AC-3
- [ ] Submit the sign in form empty, then with `not-an-email` → field errors "Enter your email address", "Enter your password", "Enter a valid email address"; the email field gets focus → AC-3
- [ ] New admin: press Set up, type a wrong code → "That code is incorrect. Try the current code from your app."; reload → "Already scanned the QR code?" form; the code from the QR you already scanned enrolls → AC-4
- [ ] After only the password step, open `/admin` and `/admin/reset-password` → redirected to `/admin/mfa?next=...` → AC-5
- [ ] Signed in fully, run `pnpm admin:disable --email ...`, then click anything → store 404 "We can't find that page", no admin hint → AC-6
- [ ] Sign in with `next=//evil.example/admin` → lands on `/admin` → AC-12
- [ ] `/admin/forgot-password` with the admin's email and with an unknown one → the same "If that email belongs to an admin..." reply; only the admin gets a Mailpit email → AC-9
- [ ] Open the reset link → a Continue page (nothing spent yet); Continue → TOTP step → `/admin/reset-password`; `short` names each missing part; the current password shows "Choose a password you have not used here before."; a valid one lands on `/admin`; the same link again → "That link is invalid or has expired. Request a new one." → AC-9, AC-10
- [ ] Reset link for an admin who never enrolled → "Your authenticator is not set up. Contact the store owner.", no setup button, Sign out offered → AC-4
- [ ] 5 wrong codes, then a 6th attempt → `/admin/sign-in` with "Too many incorrect codes. Please sign in again."; sign in again within 15 minutes and enter a right code → refused the same way → AC-16
- [ ] At aal1 open `/admin/sign-in` → `/admin/mfa`; at aal2 open `/admin/forgot-password` → `/admin` → AC-17
- [ ] Tab through sign in, MFA, forgot and reset pages: every field labelled, errors tied to fields, visible focus → AC-14
- [ ] Production: Firewall rule on POST to the three auth pages, 10 per minute per IP, deny 10 minutes (see the runbook) → AC-15

## Value sourcing
- [ ] Delete the admin's session row in `auth.sessions` while signed in → the next admin request goes to sign in (user id comes from `getUser()`, not a cached token)
- [ ] A session with only the password step has `aal1` in its token → pages go to the MFA step; after the code, `aal2` → panel opens
- [ ] Session start is the earliest `amr` timestamp: re-verifying a code does not extend the 12 hour cap (unit test in `access.test.ts`)
- [ ] `now` is the server clock: expiry is decided with an injected `nowMs` (unit tests in `proxy-decision.test.ts`, `access.test.ts`)
- [ ] Rename the admin in `admin_users` → the menu and welcome page show the new name on the next request
- [ ] A factor id is never taken from the browser: `verifyTotp` accepts only the code
- [ ] Wrong code count comes from `auth.mfa_challenges` for that factor: wrong codes from two different browsers add up to the same lockout
- [ ] QR issuer in the authenticator app shows the store name from `brand.name`
- [ ] Reset email is sent only when `admin_users` has the lower cased email and `disabled_at` is empty (try a disabled admin: no email)
- [ ] Reset link host is the Supabase Site URL (`http://localhost:3000` locally)
- [ ] The `reason` query param shows only the fixed messages: `?reason=<script>` shows nothing
- [ ] Log lines carry `adminId` when known, else `emailHash`, plus `ip` from the first `x-forwarded-for` entry; no password, code or token appears in `pnpm dev` output

## Commands
- [ ] `pnpm test` → unit suites pass (access, safe path, proxy decision, schemas, error mapping, log record, logger redaction) → AC-5, AC-6, AC-7, AC-10, AC-12, AC-13
- [ ] `pnpm test:stack` → the `auth.mfa_challenges` columns and the three script cores pass against the local stack → AC-11, AC-16
- [ ] `pnpm test:e2e` → admin specs (sign in, denials, password reset, a11y) pass on desktop and phone → AC-1 to AC-6, AC-8, AC-9, AC-10, AC-12, AC-14, AC-16, AC-17
- [ ] `printf 'Passw0rd!x\nPassw0rd!x\n' | pnpm admin:create --email x@example.com --name X` → prints the admin id; `pnpm admin:reset-mfa --email x@example.com` → removes factors and sessions → AC-11

## Acceptance-criteria coverage
- AC-1 e2e redirect + matcher unit test · AC-2 e2e happy path · AC-3 e2e same message + field errors · AC-4 e2e enroll, reload, reset session · AC-5 e2e pages (the action path is covered by `requireAdminSession` in every action plus unit tests) · AC-6 e2e page and action 404 · AC-7 unit tests only (Playwright cannot move the server clock) · AC-8 e2e sign out and Back · AC-9 e2e Mailpit flow · AC-10 e2e and unit · AC-11 stack tests · AC-12 unit and e2e · AC-13 unit (record shape, redaction) · AC-14 e2e axe and keyboard · AC-15 manual in production · AC-16 e2e lockout and stack pin · AC-17 e2e
