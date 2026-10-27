# Verify: Remove admin 2FA · spec 0019 · updated 2026-10-27
_Steps derived from spec 0019 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Run the app on `localhost:3000` against the local Supabase stack, with `EMAIL_TRANSPORT=mailpit`. Restart the stack once (`pnpm db:stop && pnpm db:start`) so it picks up TOTP off from `supabase/config.toml`.

## UI / manual
- [ ] `pnpm admin:create` a new admin, open `/admin/sign-in?next=%2Fadmin%2Forders`, sign in with email and password → lands on `/admin/orders`, "Signed in as <name>" shows, no code step → AC-1
- [ ] Sign in with a wrong password, an unknown email, and a customer's valid credentials → each shows "Email or password is incorrect." and leaves no `sb-` cookie → AC-1
- [ ] Make a recovery token for an admin with `auth.admin.generateLink`, open a session from it (`verifyOtp`), then `curl -I` an admin page with that cookie → a real 3xx to `/admin/sign-in?next=...`, not a 200 → AC-2
- [ ] An admin session older than 12 hours → `/admin/sign-in?reason=expired`; a disabled admin and a signed in customer → 404 on `/admin` and on an admin action; sign out ends only this device → AC-3
- [ ] Signed out, open `/admin/mfa`, `/admin/forgot-password`, `/admin/reset-password` → each redirects to `/admin/sign-in?next=<path>`; signed in as an admin → each answers 404; `/auth/confirm` answers 404 → AC-4
- [ ] `/admin/sign-in` shows no "Forgot password?" link and no reset hint; `?reason=too_many_codes` and `?reason=invalid_link` show no message; `?reason=expired` and `?reason=signed_out` show theirs → AC-5
- [ ] Signed in admin opens `/admin/sign-in?next=%2Fadmin%2Forders` → sent to `/admin/orders`; the recovery link session from the AC-2 step opens `/admin/sign-in` → stays on it → AC-6
- [ ] `/account/forgot-password` with an admin email → the usual neutral reply, Mailpit gets nothing, logs show `auth_email.skipped` with `reason: "runs_the_store"`; with a customer email → the reset email still arrives → AC-8
- [ ] Open `/account/confirm?token_hash=<admin recovery token>&type=recovery`, press Continue → `/account/confirm?failed=1&type=recovery`, the admin's password is unchanged, and `/account` sends you to sign in (the session was ended) → AC-9
- [ ] Signed in as a store runner (enabled or disabled admin row) on `/account/settings` → change password and delete account are refused → AC-10
- [ ] `/admin/sign-in` by keyboard alone (Tab from Email to Password to Sign in, Enter) reaches `/admin`; axe shows zero violations on desktop and phone, empty and with errors → AC-13

## Commands
- [ ] `pnpm admin:reset-password` with no flag → "Usage: pnpm admin:reset-password --email <email> [--env-file <path>]" → AC-7
- [ ] `pnpm admin:reset-password --email <customer only email>` → "No admin has that email." before any prompt, nothing changes → AC-7
- [ ] `pnpm admin:reset-password --email <admin>` with a 13 character password → "The password needs: - At least 14 characters"; with two different passwords → "The passwords do not match." → AC-7, AC-16
- [ ] `pnpm admin:reset-password --email <ADMIN@EXAMPLE.COM>` (upper case, also for a disabled admin) with a valid 14+ character password twice → "Password changed for <email>." then "Every session they had is signed out."; the old password no longer signs in, the new one does, and an open admin tab is sent to sign in on its next request → AC-7
- [ ] `pnpm admin:create --email <existing customer>` → asks for a new password (14+ characters), and the customer's old password no longer signs in; last line "They sign in with the password you set." → AC-15, AC-16
- [ ] `grep -rn "auth.mfa\|auth.reset.requested\|auth.password.changed" src` → nothing; the logger still redacts `code` → AC-12
- [ ] `grep -n "enroll_enabled\|verify_enabled" supabase/config.toml` under `[auth.mfa.totp]` → both `false`; `package.json` has no `admin:reset-mfa` and no `otpauth`; `tests/stack/mfa-challenges.stack.test.ts` is gone → AC-11
- [ ] `pnpm test:stack` → `admin-amr.stack.test.ts` passes (password sign in has a `password` amr entry, a recovery session has none) and `admin-scripts.stack.test.ts` passes → AC-2, AC-7, AC-15
- [ ] `docs/runbooks/admin-accounts.md` and scope feature 19 name the Firewall rule on `POST /admin/sign-in` and `POST /account/sign-in`, 10 per minute per IP, deny 10 minutes, required before the first production admin → AC-14

## Value sourcing
- [ ] Session opened by a password: an `amr` entry as a plain string `"password"` and as `{ method: "password" }` both allow; `recovery`, `otp` or an empty list send to sign in (unit `access.test.ts`, plus the AC-2 step above)
- [ ] Redirect target: `next` through `safeAdminPath`; `//evil.example/admin` lands on `/admin`
- [ ] Reason message: only `expired` and `signed_out` map to text
- [ ] Which admin may be reset: by lower cased email in `admin_users`, any `disabled_at` (the upper case and disabled cases above)
- [ ] Send or skip: `type === "recovery"` and an `admin_users` row → skip; a sign up confirm for a store runner still sends
- [ ] `runsTheStore`: true for an enabled or disabled admin row, false for a customer, with no `auth.mfa_factors` table in the db test stub

## Acceptance-criteria coverage
- AC-1 sign in steps · AC-2 recovery session 3xx and stack test · AC-3 expiry, denials, sign out · AC-4 removed pages · AC-5 sign in page · AC-6 skip sign in page · AC-7 reset script commands · AC-8 forgot page with an admin email · AC-9 old recovery link · AC-10 account settings refusals · AC-11 config and deletions · AC-12 log events · AC-13 keyboard and axe · AC-14 runbook and scope Firewall item · AC-15 create on an existing user · AC-16 the 14 character rule
