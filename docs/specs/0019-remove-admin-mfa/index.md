# 0019. Remove admin two factor sign in

**Date**: 2026-10-27
**Status**: In Progress

## Summary

Admins now sign in to `/admin` with their email and password only. The authenticator step (TOTP, a 6 digit code from a phone app) is removed completely, with all its pages, actions, scripts and tests. Because the password becomes the only lock, the password must never be changeable from an inbox alone: the admin self service password reset goes too, and an admin's password is reset only from the terminal with a new `pnpm admin:reset-password` script. The 12 hour session cap, the 404 for anyone who is not an active admin, and `admin:create` / `admin:disable` stay exactly as spec [0004](../0004-admin-sign-in/index.md) built them.

This spec supersedes the TOTP and admin reset parts of spec 0004 (AC-2 in part, AC-4, AC-5, AC-9, AC-10 in part, AC-11 in part, AC-13 in part, AC-14 in part, AC-15 in part, AC-16, AC-17 in part) and the admin branch of spec [0012](../0012-customer-accounts/index.md) AC-8 and AC-19. Everything else in those specs still holds.

## Requirements

**User stories**:
- As an admin, I want to sign in with my email and password only, so that I reach the panel without an authenticator app.
- As the store owner, I want an admin's password to be changeable only from the terminal, so that someone who takes over an admin's inbox still cannot get into `/admin`.
- As the store owner, I want every existing denial (non admins, disabled admins, the 12 hour cap) to keep working, so that removing a factor does not open anything else.

**Acceptance criteria**:
- **AC-1**: An active admin who submits the correct email and password on `/admin/sign-in` lands straight on the `next` path when it passes spec 0004 AC-12, else on `/admin`, which shows "Signed in as <name>". There is no `/admin/mfa` step. A wrong email, a wrong password, or a non admin's valid credentials still show "Email or password is incorrect." and leave no session (spec 0004 AC-3, unchanged).
- **AC-2**: `decideAdminAccess` no longer checks the assurance level (`aal1` or `aal2`, Supabase's record of how many factors a session passed) and has no `mfa` verdict. Instead an admin session must have been opened by a password: its `amr` list (the sign in methods recorded in the token) must contain a `password` entry. A session for an admin user without one (opened by an email link: `recovery`, `otp`, or a sign up confirm) gets the `sign-in` verdict on every `/admin` page and admin action, so it is redirected to `/admin/sign-in` like a visitor with no session. The proxy answers that redirect itself on page loads (a real 3xx, not a 200 streamed shell); an admin action redirects from its own guard. Both `amr` shapes Supabase uses (a plain string, or an object with `method`) are read.
- **AC-3**: The 12 hour cap from the earliest `amr` timestamp, the 404 for a user with no `admin_users` row or with `disabled_at` set, and sign out on this device only all behave exactly as spec 0004 AC-6, AC-7 and AC-8 say.
- **AC-4**: `/admin/mfa`, `/admin/forgot-password` and `/admin/reset-password` no longer exist. They behave like any unknown admin path: a visitor with no session is redirected to `/admin/sign-in?next=<path>`, and an active admin gets the 404 page. `/auth/confirm` no longer exists and answers 404, and the proxy no longer runs on `/auth/:path*`.
- **AC-5**: `/admin/sign-in` has no "Forgot password?" link and no hint about resets. Its `reason` messages are only `expired` and `signed_out`; any other `reason` value (for example an old `too_many_codes` or `invalid_link` bookmark) shows no message.
- **AC-6**: A signed in visitor who opens `/admin/sign-in` is sent on only when `decideAdminAccess` allows them: an active admin with a password session goes to the validated `next` or `/admin`. Anyone else sees the sign in page.
- **AC-7**: `pnpm admin:reset-password --email <e> [--env-file <path>]` finds the admin by lower cased email in `admin_users` (enabled or disabled, the same lookup as `admin:disable`), prompts twice for a hidden password, checks it with `adminPasswordSchema` (AC-16, naming each missing part), refuses "The passwords do not match." on a mismatch, and sets it with `auth.admin.updateUserById(admin.id, { password })`. Its strings: without `--email`, "Usage: pnpm admin:reset-password --email <email> [--env-file <path>]"; no row, "No admin has that email." (nothing changes); Supabase refusing, "Could not set the password: <message>"; success, "Password changed for <email>." then "Their open sessions stay signed in until the 12 hour cap. If the account is compromised, run admin:disable first." It writes no log line: Supabase's own auth audit log records the admin API update.
- **AC-8**: The Send Email Hook sends nothing for a `recovery` email to a user who runs the store (`runsTheStore`, AC-10): it answers 200 so Supabase does not retry or surface an error, and logs `auth_email.skipped` with the user id and `reason: "runs_the_store"`. The customer `/account/forgot-password` page still shows its usual neutral reply for that email, at the same speed. The `admin_reset` email kind and `emails/admin-reset-password.tsx` are removed.
- **AC-9**: A recovery link for a user who runs the store that still reaches `/account/confirm` (an old link, or one made outside the app) changes no password: after `verifyOtp` the action ends the session it just made on this device (`signOut({ scope: 'local' })`) and redirects to `/account/confirm?failed=1&type=recovery`. A sign up confirm for a store runner keeps their password as today (spec 0012).
- **AC-10**: `runsTheStore(userId)` is true only when an `admin_users` row exists for that id, in any state. It no longer reads `auth.mfa_factors`. Its other callers (customer set password, change password, delete account) keep refusing a store runner as today.
- **AC-11**: `supabase/config.toml` sets `[auth.mfa.totp] enroll_enabled = false` and `verify_enabled = false`. The `admin:reset-mfa` script and package script, the `otpauth` dev dependency, the TOTP e2e helpers, and every MFA unit, e2e and stack test (`tests/stack/mfa-challenges.stack.test.ts` included) are deleted, and the test auth stub no longer creates `auth.mfa_factors`. The runbook records the same TOTP setting for the production Supabase project and a one time step to delete existing factors.
- **AC-12**: The `auth.mfa.enrolled`, `auth.mfa.succeeded`, `auth.mfa.failed`, `auth.mfa.locked`, `auth.reset.requested` and `auth.password.changed` events are no longer emitted. Every other `auth.*` event and the logger's redaction (including the `code` key) are unchanged; comments that justify the `code` redaction by TOTP codes are reworded (auth codes in general).
- **AC-13**: `/admin/sign-in`, now the only admin auth page, still works by keyboard alone and axe reports zero violations on desktop and phone (spec 0004 AC-14, narrowed to this page).
- **AC-14**: The scope's production deploy item for the Vercel Firewall rate limit covers `POST /admin/sign-in` and `POST /account/sign-in` (an admin's password works on both, and both sessions open `/admin`), 10 per minute per IP, deny 10 minutes, and is marked required before the first production admin exists. Spec 0004 AC-15 is replaced by this rule.
- **AC-15**: `pnpm admin:create` for an email that already has an auth user (for example a customer) no longer keeps that user's password: it prompts for a new one like a new user (AC-16) and sets it together with `email_confirm: true`, so a password planted through public sign up on an unconfirmed user can never become an admin password. Its last line becomes "They sign in with the password you set." (the authenticator line goes).
- **AC-16**: Admin passwords set by the scripts must pass `adminPasswordSchema`: the shared `passwordSchema` rule plus at least 14 characters, named as its own missing part ("At least 14 characters"). Customer passwords keep the spec 0004 AC-10 rule. Customer password change and set password already refuse a store runner (AC-10), so the scripts are the only way an admin password is set.

## Decision

**Chosen option**: Option 3: remove TOTP completely and move admin password resets to the terminal.

The guard accepts a password session at any assurance level, every MFA surface is deleted, and the only way to change an admin password without knowing it is `pnpm admin:reset-password`, which needs the production service role key.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`)

**Decisions made in the grilling session** (fixed inputs, 2026-10-27):
- Remove TOTP completely; no flag, no optional per admin factor.
- The password as the only lock is an accepted risk (see Consequences).
- Keep the 12 hour cap, `admin:create`, `admin:disable`, the 404 denials, the proxy first gate and the logger's `code` redaction.
- Replace the admin email reset with `pnpm admin:reset-password`; it does not end sessions; `admin:disable` is the immediate cut off.
- Remove the sign in page's reset link with no replacement hint.
- `runsTheStore` checks `admin_users` only; a store runner gets no reset email from either flow.
- Turn TOTP off in `config.toml` and in the production project; delete existing factors once.
- The Firewall rule covers admin sign in only and becomes required before launch (widened to `/account/sign-in` after the cross check, AC-14).
- Work on the current branch `feat/defer-analytics`, one Conventional Commit per milestone.

**Decisions made while writing** (each with its runner up):
- **Admin sessions must come from a password (AC-2)**: once `aal2` is gone, any session for an admin user would open the panel, including one made by verifying an email link (`verifyOtp` signs the user in). Requiring a `password` entry in `amr` keeps "an inbox alone never opens `/admin`" true even if a recovery or confirm link for an admin is ever made. It replaces `isResetSession`, which only existed to stop enrollment. Runner up: rely on the hook never sending admin links, which leaves the panel one mistake away from an inbox takeover.
- **One `amr` source in the guard (AC-2)**: after `getUser()` confirms the user, the guard reads `amr` from `getClaims()` (as the proxy already does) instead of `mfa.getAuthenticatorAssuranceLevel()`, so no `auth.mfa` API stays in use. A pure `hasPasswordMethod(amr)` beside `sessionStartedAtSeconds` reads both entry shapes. A stack test pins the assumption the whole rule rests on: `signInWithPassword` gives a `password` entry, and a recovery link verified with `verifyOtp` gives none. Runner up: keeping `getAuthenticatorAssuranceLevel()`, a second reader of the same token from an API this change otherwise drops.
- **The proxy redirects password less sessions (AC-2)**: `decideAdminGate` today continues on `sign-in`, which under Cache Components lets the page's own `redirect()` answer 200. It now redirects page loads to `signInPath({ next })` on a `sign-in` verdict (expiry is still decided earlier by `decideProxy`). Runner up: leaving it to the page guard, which breaks the status code rule in `AGENTS.md`.
- **A stronger admin password (AC-16)**: with one factor, length is the cheapest real defense against guessing that slips past rate limits (the Supabase API is callable directly with the public anon key). 14 characters with a password manager costs the operator nothing. Runner up: keeping 8, which spec 0004 accepted only because TOTP sat behind it.
- **`admin:create` sets the password for an existing user (AC-15)**: public sign up lets anyone create an unconfirmed user with a password they know; `admin:create` confirming that user would hand the stranger an admin password. Runner up: refusing unconfirmed users only, which still keeps a customer's weaker password as the admin password.
- **The hook skips instead of refusing (AC-8)**: answering 200 without sending means Supabase reports success to `resetPasswordForEmail`, so the customer page's reply and timing do not change and nothing reveals that the email belongs to an admin. The skip is decided before the kind: `AuthEmailKind` becomes `"confirm_signup" | "customer_reset"`, and `authEmailLink` loses the `/auth/confirm` path. If `runsTheStore` throws, the hook still answers 500 as today (no send). `usedActionType` already refuses every other email type (magic link, invite, email change) with 400, which stays. Runner up: answering 4xx, which Supabase turns into an error on the reset call (visible in logs, and a timing difference).
- **Delete `/auth/confirm` instead of refusing there (AC-4)**: it only ever served the admin reset. With no admin reset emails, it has no legitimate visitor, and an old link should 404 like any dead path. The proxy matcher drops `/auth/:path*`. `robots.ts` keeps disallowing `/auth` (harmless, and one less change). Runner up: keep the route and redirect every link to the invalid link message, which keeps dead code alive.
- **Sign out after a refused recovery confirm (AC-9)**: `verifyOtp` already set a session cookie before the store runner check runs. AC-2 would block it from `/admin` anyway, but leaving a stray signed in session from a refused link is wrong on its face, so the action ends it on this device. Runner up: leave the session, relying on AC-2 alone.
- **`admin:reset-password` touches no `auth` table directly**: it finds the admin by `admin_users.email` (as `disableAdmin` does, so the two scripts cannot disagree about who is an admin) and sets the password with `auth.admin.updateUserById(admin.id, { password })`, so Supabase's own password policy applies too. The stack test also records whether that call ends the user's other sessions; the runbook states the observed result. With `admin:reset-mfa` gone, the app no longer writes to the `auth` schema anywhere. Runner up: also deleting `auth.sessions` rows to sign out every device, which the grilling session declined (the 12 hour cap bounds old sessions, and `admin:disable` cuts access at once).
- **Old `reason` keys are dropped, not mapped (AC-5)**: `messages.ts` maps keys to fixed strings and ignores unknown keys, so removing `too_many_codes`, `invalid_link`, `invalid_code`, `mfa_not_set_up`, `reset_sent`, `same_password` and `mismatch` from the admin table needs no extra handling. `mismatch` and the password rule parts move to the script's own output if the script needs them; the shared `passwordSchema` stays where it is.
- **`safeAdminPath` keeps refusing the removed paths**: its auth page list becomes `/admin/sign-in` only. `/admin/mfa`, `/admin/forgot-password` and `/admin/reset-password` then pass as ordinary admin paths and 404 after sign in (AC-4), which is harmless and keeps the rule simple. Runner up: keeping them in the deny list forever, which keeps dead names in live code.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**: no schema change and no migration. What this feature reads:

| Table | Owner | Used for |
|---|---|---|
| `admin_users` | app, spec 0002 | admin authority (unchanged) and `runsTheStore` (now its only input) |
| `auth.users` | Supabase | read only lookup by lower cased email in `admin:reset-password` |
| `auth.mfa_factors`, `auth.mfa_challenges` | Supabase | no longer read by the app; existing rows deleted once by hand (runbook) |

**State transitions** (one admin session):

```
no session ──password ok + active admin──▶ password session (panel open)
                                              ├──sign out──────────▶ no session (this device)
                                              ├──12h since sign in──▶ no session (proxy signs out)
                                              └──disabled_at set────▶ 404 on every request
email link session (recovery, otp, confirm) for an admin user ──▶ treated as no session (AC-2)
```

**`decideAdminAccess` verdicts** (pure, unit tested; checked in this order):

| Input state | Verdict |
|---|---|
| no verified user | `sign-in` |
| session age over 12 hours | `sign-in` with reason `expired` |
| no `admin_users` row, or `disabled_at` set | `not-found` |
| `amr` has no `password` entry | `sign-in` |
| otherwise | `allow` with the admin |

`AccessInput` loses `aal` and `allowAal1`; `AccessVerdict` loses `mfa`; `AdminSession` loses `aal` and `fromResetLink`. `requireAdminSession` and `requireAdmin` remain (or fold into one, a build detail). `redirectIfSignedIn` acts only on `allow`. `adminMetadata` loses its `allowAal1` option (its `layout` option stays). The proxy's `decideAdminGate` drops the `mfa` redirect and `aal1AdminPages`; `publicAdminPages` becomes `["/admin/sign-in"]`.

**API surface** (what changes; everything else in spec 0004 stays):

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `signIn` | action | email, password, next | redirect to `safeAdminPath(next)` | public | unchanged (spec 0004) |
| `/admin/sign-in` | page | `next?`, `reason?` (`expired`, `signed_out`) | form, no reset link | public; `redirectIfSignedIn` | none |
| `requireAdmin()` | server function | none | `{ id, email, name }` | the check | `redirect()` to sign in, or `notFound()` |
| `handleSendEmailHook` | route `POST /api/auth/send-email` | signed payload | 200, sends the email or skips a store runner's recovery | Standard Webhooks signature | unchanged |
| `confirmEmail` | action | token_hash, type | redirect | public | store runner recovery → sign out, `?failed=1&type=recovery` |
| `pnpm admin:reset-password` | script | `--email`, `--env-file?`, hidden password twice | "Password changed for <email>." plus the sessions note | service role key + DB URL | unknown admin, weak password, mismatch, Supabase error |
| removed | | `/admin/mfa`, `enrollTotp`, `verifyTotp`, `/admin/forgot-password`, `requestPasswordReset` (admin), `/auth/confirm`, `/admin/reset-password`, `resetPassword`, `admin:reset-mfa` | | | |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `requireAdmin`, proxy gate | session opened by a password | `hasPasswordMethod(getClaims().claims.amr)`: an entry that is `"password"` or has `method === "password"` |
| `requireAdmin`, proxy | session start, 12 hour cap, active admin | unchanged from spec 0004 |
| `signIn` | redirect target | `next` input through `safeAdminPath()`, else `/admin` |
| sign in page | reason message | `reason` param mapped to `expired` or `signed_out`; anything else shows nothing |
| `admin:reset-password` | which admin, may reset | `admin_users` by lower cased `--email`, any `disabled_at` |
| `admin:reset-password` | new password | hidden prompt, twice, `adminPasswordSchema` |
| `admin:create` (existing user) | new password | hidden prompt, twice, `adminPasswordSchema` |
| Send Email Hook | send or skip | `type === "recovery"` and `runsTheStore(user.id)` |
| `confirmEmail` | refuse a store runner's reset | `runsTheStore(data.user.id)` after `verifyOtp` |
| `runsTheStore` | true or false | `EXISTS` on `admin_users` by id |

**Key invariants**:
- An admin page or action runs only for a password session of an active admin, younger than 12 hours. No other session state opens the panel.
- An admin password changes only through `pnpm admin:reset-password` (service role key) or by someone who already knows it. No email, link or page can change it.
- A store runner never receives a password reset email from any flow.
- Admin authority still comes only from a live `admin_users` row, checked on every request; the proxy can only deny earlier, never grant.
- The app writes nothing to Supabase's `auth` schema and reads only `auth.users` (scripts). It no longer reads `auth.mfa_*`.
- Passwords are never logged or passed as a flag (prompt only, so they stay out of shell history).

**Security model**:
- One factor: the password, at least 14 characters (AC-16). Brute force protection is Supabase's shared `sign_in_sign_ups` rate limit until the Vercel Firewall rule on `POST /admin/sign-in` and `POST /account/sign-in` is live (AC-14); the rule must exist before the first production admin. Supabase's Auth API is also callable directly with the public anon key, where only Supabase's own limits apply; the password length is the defense there.
- Inbox takeover: closed by AC-2, AC-8 and AC-9 together (no admin reset email, no admin link that opens the panel, no password change from a link). This rests on the production Send Email Hook being on: with it off, Supabase's default recovery email would reach the admin, and its link could set a new password through the Auth API directly (AC-2 blocks only that link's session). The deploy runbook checks it: a recovery request for an admin email must produce no email.
- Planted passwords: closed by AC-15 (`admin:create` always sets the password).
- Password theft: an attacker with the password has full panel access until the password is changed and their session ends. Response: `admin:disable` (immediate), then `admin:reset-password`, then wait 12 hours (so every session made with the old password passes the cap) before re-enabling with `admin:create` (which sets a password again, AC-15). Re-enabling sooner revives the attacker's session, unless the stack test showed the password change ends other sessions.
- Enumeration: the sign in reply and the customer reset reply still do not reveal whether an email is an admin.
- Compliance: unchanged from spec 0004 (admin emails and names logged only as id or hash).

**Configuration required** (no new env vars):
- `supabase/config.toml`: `[auth.mfa.totp] enroll_enabled = false`, `verify_enabled = false`.
- Production Supabase project (dashboard, at deploy): TOTP enroll and verify off, after deleting existing factors.
- `package.json`: add `admin:reset-password`, remove `admin:reset-mfa`, remove the `otpauth` dev dependency.
- `next.config.ts`: the comment that mentions TOTP codes printed to the terminal is reworded.

**Critical test scenarios**:
- Happy path: e2e, a seeded admin signs in with email and password and lands on `/admin` with their name, then on a `next` path, verifies **AC-1**
- Failure case: unit, `decideAdminAccess` allows an admin at `aal1` with a `password` amr entry, and returns `sign-in` for amr lists with only `recovery`, only `otp`, or no entries, verifies **AC-2**
- Failure case: unit, the 12 hour boundary (exactly 12h, 12h plus 1s) and disabled or missing rows still give `sign-in` (expired) and `not-found`, verifies **AC-3**
- Failure case: e2e, `/admin/mfa`, `/admin/forgot-password`, `/admin/reset-password` redirect a signed out visitor to sign in and 404 for an admin; `/auth/confirm` answers 404, verifies **AC-4**
- Failure case: e2e plus axe, the sign in page has no reset link, ignores `reason=too_many_codes`, and has zero violations on desktop and phone, verifies **AC-5**, **AC-13**
- Failure case: unit, a signed in admin opening `/admin/sign-in` is redirected on; an email link session is not, verifies **AC-6**
- Failure case: stack test beside `admin-scripts.stack.test.ts`, `admin:reset-password` changes the password of an admin (enabled and disabled), refuses an email with no `admin_users` row (also a customer only email), rejects a 13 character password, and records whether the admin's other sessions survive, verifies **AC-7**, **AC-16**
- Failure case: stack test, `admin:create` on an existing unconfirmed user with a planted password: the planted password no longer signs in, the new one does, verifies **AC-15**
- Failure case: stack test, `signInWithPassword` gives a `password` amr entry and a `verifyOtp` recovery session gives none, and `decideAdminAccess` / the proxy gate redirect the latter to sign in (proxy unit test for the 3xx), verifies **AC-2**
- Failure case: unit plus e2e, the hook answers 200 and sends nothing for a store runner's recovery (Mailpit stays empty), still sends a customer's reset, and the customer forgot page shows the same reply, verifies **AC-8**
- Failure case: unit, `confirmEmail` with a store runner's recovery signs out locally and redirects to `?failed=1&type=recovery`, verifies **AC-9**
- Failure case: db test, `runsTheStore` is true for an enabled or disabled admin row and false for a customer, with no `auth.mfa_factors` table in the stub, verifies **AC-10**
- Auth/permission: a signed in non admin and a disabled admin still get 404 on `/admin` and on an admin action, verifies **AC-3**

## Build plan

Tracer Bullet, ordered so every commit typechecks on its own (the pre commit hook runs `pnpm typecheck`) and no commit ever has an admin email reset without TOTP behind it: the reset path goes first, while TOTP still guards the panel, then the guard drops TOTP, then config and records. Nothing deploys yet.

1. **Spec** (this file): `docs(specs): ...`. satisfies all ACs as the record
2. **Terminal reset replaces the email reset** (TOTP still on): add `adminPasswordSchema` and `scripts/admin/reset-password.ts` with the `admin:reset-password` package script and its stack test; `admin:create` sets the password for an existing user, new last line; delete `app/admin/(auth)/forgot-password`, `app/admin/(auth)/reset-password`, `app/auth/confirm`, the admin `password-reset` action, `confirm-reset-link-form`, the sign in page's reset link, and their tests; drop `/auth/:path*` from the proxy matcher and the `/auth` branch in `proxy.ts`; `runsTheStore` on `admin_users` only, and drop `auth.mfa_factors` from `tests/db/auth-stub.ts`; the hook skips a store runner's recovery and logs `auth_email.skipped`; `AuthEmailKind` without `admin_reset`, `emails/admin-reset-password.tsx` and its `render-auth` case removed; `confirmEmail` signs out and redirects with `failed` for a store runner's recovery, `adminResetPath` removed; rewrite `tests/e2e/account/password-reset.spec.ts` (no email for a store runner), remove `tests/e2e/admin/password-reset.spec.ts`, update `tests/e2e/seo/seo.spec.ts` for the removed pages; reword the comment in `account/actions/password-reset.ts`. satisfies **AC-4** (reset pages, `/auth/confirm`), **AC-7**, **AC-8**, **AC-9**, **AC-10**, **AC-15**, **AC-16**
3. **Password only guard and sign in**: `hasPasswordMethod` and `decideAdminAccess` without `aal` and `mfa`, with the `password` rule (replacing `isResetSession`); the guard reads `amr` from `getClaims()`; `requireAdminSession` / `adminMetadata` / `redirectIfSignedIn` without `allowAal1` and the `mfa` branch; proxy `decideAdminGate` redirects page loads on `sign-in`, drops the `mfa` redirect, `publicAdminPages` = sign in only, `aal1AdminPages` and `mfaPath` removed; `signIn` redirects to `safeAdminPath(next)`; `safeAdminPath` auth page list = sign in only; delete `app/admin/(auth)/mfa`, `actions/mfa.ts`, `factors.ts`, `mfa-lockout.ts`, `mfa-view.ts`, `totp-setup.tsx`, `totp-code-form.tsx`, `scripts/admin/reset-mfa.ts` and `admin:reset-mfa`, the MFA log events and messages, and their tests; delete `tests/stack/mfa-challenges.stack.test.ts`, the TOTP helpers in `tests/e2e/admin/support.ts` and the `otpauth` dependency; add the amr stack test; update the unit tests for the new verdict table and the e2e sign in, denials and a11y specs. satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4** (`/admin/mfa`), **AC-5**, **AC-6**, **AC-11** (code part), **AC-12**, **AC-13**
4. **Config and records**: `supabase/config.toml` TOTP off; reword the `code` redaction comments (`next.config.ts`, `src/features/dashboard/log.ts`, the logger); `docs/runbooks/admin-accounts.md` (sign in without TOTP, `admin:reset-password`, the 14 character rule, the compromised account steps with the 12 hour wait or the observed session result, delete existing factors once then turn TOTP off, the hook check, the Firewall rule on both sign in paths); spec 0004 and 0012 status lines and superseded AC notes; `README.md`; the scope (feature 5 note, feature 19 items, this feature's row). satisfies **AC-11**, **AC-14**

## Migration plan

**Strategy**: big bang (one branch, one merge), acceptable because nothing is deployed yet and there is one operator.
**Phases**:
1. Merge milestones 2 to 4 together.
2. Locally: `pnpm db:start` picks up the TOTP setting on the next start; delete leftover dev factors with `DELETE FROM auth.mfa_factors;` against the local database (or reset the local stack).
3. At production deploy (scope feature 19): delete existing factors in the Supabase dashboard (Authentication, Users, each admin, remove factor) or with SQL, then turn TOTP enroll and verify off, then apply the Firewall rule before creating the first admin.

**Rollback**: revert the merge. Deleted factors cannot be restored, so after a rollback each admin enrolls again at their next sign in (spec 0004 AC-4).
**Risks**: forgetting the Firewall rule leaves sign in limited only by Supabase's shared rate limit; the runbook and the scope item mark it as required before launch.

## Consequences

**Positive**:
- Sign in is one step, with no authenticator app to install, lose or recover.
- A large, fragile surface goes away: the MFA page, the lockout that read Supabase's internal `auth.mfa_challenges`, the only write the app ever made to `auth.sessions`, the TOTP timing logic in e2e, and the `otpauth` dependency.
- The inbox takeover path is closed harder than before: no admin reset email exists at all.

**Negative / tradeoffs**:
- A leaked, phished or guessed admin password is now enough to open the panel (orders, refunds, customer personal data, prices, discounts). This is the accepted risk; a strong unique password and a password manager are the mitigation the runbook asks for.
- Until the Vercel Firewall rule is live, brute force protection on sign in is only Supabase's rate limit, shared by every caller from Vercel's servers.
- An admin who forgets their password needs you at a terminal with production credentials; there is no self service recovery.
- `admin:reset-password` leaves the admin's other sessions alive for up to 12 hours; a compromised account needs `admin:disable` first, then a reset, then `admin:create` to re-enable.
- If 2FA is wanted again later (more admins, a compliance need), it is rebuilt from history, not toggled back on.
- An admin who signs in through `/account/sign-in` gets a working `/admin` session, but no `auth.sign_in.*` event is written for it (the account flow logs `account.*` events). The admin sign in audit trail misses those sign ins; Supabase's own auth audit log still has them.

**Neutral**:
- Many specs, tests and docs mention TOTP (specs 0005, 0010, 0011, 0012, 0015, 0016, reviews). Closed specs are history and are not rewritten; only 0004 and 0012 get status notes, and `/sync` updates the AGENTS.md files.
- `robots.ts` still disallows `/auth`, which now has no pages.

## Follow-up

- [ ] Scope feature 19 (Production deploy): delete existing factors, turn TOTP off in the production project, apply the Firewall rule on `POST /admin/sign-in` and `POST /account/sign-in`, and check that the Send Email Hook is on (a recovery request for an admin email produces no email), all before the first admin exists.
- [ ] `/sync`: update `src/features/account/AGENTS.md` (`runsTheStore`, the hook skip, `confirmEmail`, its line on the admin reset), the root `AGENTS.md` context line for admin auth if any mentions TOTP, and `emails/AGENTS.md` (the admin reset template is gone).
- [ ] If more admins join or a compliance need appears, decide 2FA again in a new spec (passkeys would be the first option to weigh).
