# Review, feat/admin-sign-in, 2026-09-25

**Reviewed by**: Sonnet 5 (author model unrecorded)
**Scope**: 72 files (excluding the lockfile), feat/admin-sign-in vs main
**Verdict**: Approve with nits

## Summary

This change builds admin sign in end to end: Supabase Auth with a password step plus a required TOTP step, a pure `decideAdminAccess` function that every page, action and the proxy funnel through, a 12 hour session cap, password reset by email with TOTP required before the new password, three account lifecycle scripts, structured pino logging with redaction, and a large Vitest plus Playwright suite covering the logic and the flows. You asked for typecheck, lint and the unit suite to be run as part of this review; all three pass clean (`pnpm typecheck`, `pnpm lint`, `pnpm test`: 323 tests green).

The work matches spec 0004 closely. I traced the access control paths (proxy, `requireAdmin`, `decideAdminAccess`, the MFA lockout, the reset link flow, `safeAdminPath`) line by line against the acceptance criteria and found no correctness or security defects. What follows are two small, real gaps worth a look, not blockers.

## Minor

### 🟡 A disabled admin's sign in failure is logged by email hash even though the admin id is known, `src/features/admin-auth/actions/sign-in.ts:49`
**Problem**: When `admin` is found but `admin.disabledAt !== null`, the code already holds `admin.id`, yet the log call passes `email` instead of `adminId: admin.id`. AC-13 says every auth event carries "the admin id when known, a SHA-256 hash of the lower cased email otherwise." Here the id is known and the code still falls back to the hash.
**Why it matters**: It is a small, direct deviation from a documented contract (AC-13), and it makes a disabled admin's failed attempts harder to correlate with that admin's other log lines by id, which is the opposite of what the invariant is for. Low impact since the same information (the account exists and is disabled) is still visible from the "not_admin" reason and the hash, but it is worth aligning with the stated rule or noting the exception in the spec.
**Suggested fix**: When `admin` is not null, pass `adminId: admin.id` instead of `email` on that log call, and reserve the email hash path for the case where no `admin_users` row exists at all.

### 🟡 The MFA page's "verify" and "not set up" views are not exercised by the axe test, `tests/e2e/admin/a11y.spec.ts:53`
**Problem**: `test("the MFA views have no axe violations", ...)` only walks a brand new admin through the setup flow (the "setup" and "setup-pending" style states) and its wrong code error. It never checks the plain "Enter your code" view that an already enrolled admin sees (`mfa-view.ts`'s `"verify"` case), and never checks the "Authenticator needed" view for a reset link session with no factor (the `"not-set-up"` case, covered functionally in `tests/e2e/admin/password-reset.spec.ts` but not with an axe check).
**Why it matters**: AC-14 asks for zero axe violations on every auth page "including error states," and these are two distinct rendered states of `/admin/mfa` with their own markup, not variations of what is already covered. Since tests are configured for this project, new UI states without a11y coverage are a real gap, even a small one.
**Suggested fix**: Add an axe check for a `signInFully`-style admin hitting `/admin/mfa` directly (the verify view), and one for the reset link, no factor case already set up in `password-reset.spec.ts`.

## Nits

- ⚪ `src/features/admin-auth/actions/mfa.ts:37`, when `enrollTotp` finds an already verified factor (a stale "Set up authenticator" click from a second tab after verifying elsewhere) it redirects to a bare `/admin/mfa`, dropping whatever `next` the caller had. Every other redirect in this feature carries `next` through `safeAdminPath`/`mfaPath`; this one is the one exception. Very small blast radius since it only lands the admin on the verify view instead of their original target, but easy to make consistent.

## Strengths

- The access control design is genuinely disciplined: one pure `decideAdminAccess` function, unit tested at the exact 12 hour boundary and one second past it, and every page, layout, action and the proxy all funnel through `requireAdmin`/`requireAdminSession`. Nothing reads `user_metadata` or trusts a client supplied factor id.
- `safeAdminPath` is tested against a real set of open redirect tricks (`//evil.test`, backslash forms, `javascript:`, percent encoded dot segments) and the tests genuinely exercise the URL normalization edge cases rather than just the obvious ones.
- The wrong code lockout (AC-16) reads a Supabase internal table and the team pinned its shape with a stack test against the real local auth schema, so a Supabase upgrade that reshapes it fails loudly in CI instead of silently disabling the lockout.
- Logging redaction is tested at five levels of nesting for every sensitive key, and the events consistently avoid leaking passwords, codes, secrets or raw emails.
- The Playwright coverage is unusually complete for a first pass: real Mailpit email reads, real TOTP codes from `otpauth`, the reload-keeps-the-same-QR-code case, the five-wrong-codes lockout persisting across a fresh sign in, and Back-button behavior after sign out are all exercised against a real local Supabase stack rather than mocks.

## Test coverage

Very strong. Pure logic (`decideAdminAccess`, `decideProxy`, `safeAdminPath`, `classifyAuthError`, the password and TOTP schemas, the log record shape, pino redaction) is unit tested including boundary cases. The three admin scripts and the `auth.mfa_challenges` dependency are covered by stack tests against a real local Supabase instance. The full user flows (sign in, MFA enroll and verify, lockout, denials, password reset, accessibility) are covered by Playwright against a real stack in CI. The only real gaps are the two MFA page states noted above under Minor; nothing else new or changed in this branch is untested.
