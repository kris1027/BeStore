# Review, feat/defer-analytics, 2026-10-27

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 112 files, branch vs main (merge base 7e00d5b, plus uncommitted docs edits)
**Verdict**: Approve with nits

## Summary
Spec 0019 removes admin TOTP/MFA, the admin email reset and `/auth/confirm`, and replaces them with a password only guard that also requires a `password` entry in `amr`, plus `pnpm admin:reset-password`. The security model holds up: every admin page, layout, action and the one admin route (sign-out, deliberately open) is guarded, the proxy and `requireAdmin()` share `decideAdminAccess`, and an email link session is turned away both in the proxy (real redirect) and in the guard. The only findings are stale nested docs and small cleanups.

## Minor
### 🟡 Stale account AGENTS.md still describes the admin reset and TOTP, `src/features/account/AGENTS.md:15,28`
**Problem**: Line 15 says the hook "picks the template (admin reset first)"; line 28 says a store runner "always gets the admin reset email" and mentions a verified TOTP factor and `auth.mfa_factors` reads. After this change the hook skips store runners' recovery email and `runsTheStore` reads `admin_users` only.
**Why it matters**: This file is loaded as agent context; it now contradicts the code and spec 0019 AC-8, AC-10.
**Suggested fix**: Reword both lines (skip, `admin_users` only, no `auth.mfa_factors`). Likely /sync's job, but it should land with this branch.

### 🟡 Double admin lookup in the reset script, `scripts/admin/reset-password.ts:14-17`
**Problem**: `findAdminId` is called to fail early, then `resetAdminPassword` looks the admin up again.
**Why it matters**: Harmless, but two reads of the same row and a small chance of divergence; `resetAdminPassword` could accept an id or the script could just call it after prompting.
**Suggested fix**: Keep the early refusal but pass the found id into the reset step.

## Nits
- ⚪ `src/features/admin-auth/require-admin.ts:20`, if `getClaims()` fails after `getUser()` succeeded, `amr` is null and the user is sent to sign in with `reason=expired`; fail closed is right, the "expired" message is slightly misleading.
- ⚪ `src/features/admin-auth/proxy.ts:107`, gate lookup failure still fails open (pre-existing; page guard still refuses), worth keeping the comment current.
- ⚪ `src/features/admin-auth/sign-out.ts:6-8`, import order is inconsistent (`endLocalSession` import after local imports); cosmetic.
- ⚪ `tests/e2e/admin/denials.spec.ts:31`, `/admin/mfa` assertion is fine but duplicates `sign-in.spec.ts:105` removed paths check.

## Strengths
- Password only rule is pinned where it matters: `tests/stack/admin-amr.stack.test.ts` proves a password sign in has a `password` amr and a verified recovery link does not, and `admin-scripts.stack.test.ts` pins that the reset ends every session.
- `decideAdminAccess` is pure, fails closed on unreadable `amr`, handles both `amr` shapes; the proxy can only deny earlier, never grant, and gives a real 3xx for password-less sessions.
- Defense in depth for admin inbox takeover: hook skips recovery for store runners (200, same timing), `confirmEmail` signs out and refuses, `admin:create` overwrites a planted password and confirms email, 14 char admin password.
- Clean removal: no remaining MFA/TOTP/`otpauth`/`/auth/confirm` references in code, config, emails or runbooks beyond intentional removed-path tests; runbook updated with compromise procedure and Firewall rule widened to `/account/sign-in`.

## Test coverage
Good. Unit tests cover access verdicts, both `amr` shapes, proxy decisions and gate, `requireAdmin`, hook skip, confirm refusal, password schema, CLI helpers and script cores. Stack tests pin Supabase behaviors the design relies on; e2e covers sign in, removed paths, denials, a recovery-link admin session being refused, and a11y of the sign-in page. No gaps found in new logic.
