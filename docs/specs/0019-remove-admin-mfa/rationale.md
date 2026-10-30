# 0019. Remove admin two factor sign in: rationale

## Context

Spec [0004](../0004-admin-sign-in/index.md) requires every admin to pass a TOTP step (a 6 digit code from an authenticator app) after their password, every sign in. The store has one operator, who also builds it. The step adds daily friction, and its supporting machinery is large: an MFA page with enroll and verify views, a per factor wrong code lockout that reads Supabase's internal `auth.mfa_challenges` table, a recovery script that writes to `auth.sessions`, TOTP timing logic in every admin e2e test, and an `otpauth` dependency.

The TOTP step also carries a second, less visible job. Admin password resets go through email, and spec 0004 put the new password behind the TOTP step so that someone who controls only the admin's inbox cannot take over the panel. Spec [0012](../0012-customer-accounts/index.md) kept that promise when customer accounts arrived: any user who runs the store gets the admin reset email, which leads to the TOTP step. Removing TOTP without replacing that job would make an inbox takeover equal to a panel takeover.

A third detail matters: Supabase signs a user in when it verifies an email link (`verifyOtp`). With TOTP gone, the guard no longer distinguishes how a session was opened, so any session for an admin user would open the panel unless something else checks it.

The store is not deployed yet, so no production admin, factor or session exists; the change can land in one step.

## Options considered

### Option 1: Keep TOTP, make it optional per environment

A flag such as `ADMIN_MFA_REQUIRED`, off in local development and on in production.

**Pros**:
- Production keeps two factors; local work loses the friction.

**Cons**:
- Every guard and test path doubles (with and without the step), and the code that is off locally is the code least exercised before production.
- Keeps all of the machinery this change wants gone.

### Option 2: Keep TOTP, make it optional per admin

Admins may enroll a factor; the guard requires `aal2` only for admins who have one.

**Pros**:
- Security conscious admins keep the second factor.

**Cons**:
- Keeps the whole MFA surface plus a new branch in the guard.
- An attacker with the password of an admin who never enrolled walks in, so the store's real security level is the weakest admin's.

### Option 3: Remove TOTP completely, reset admin passwords from the terminal

Delete every MFA surface, accept password sessions, and replace the email reset with a CLI script.

**Pros**:
- The smallest system: one sign in step, no MFA code, no internal `auth` table access beyond a read only user lookup.
- Closes the inbox takeover path completely (no admin reset email exists), instead of guarding it.

**Cons**:
- The password becomes the only factor.
- Admins lose self service password recovery; the operator must run a script with production credentials.

### Option 4: Remove TOTP, keep the email reset as is

Delete MFA but leave `/admin/forgot-password` working without the TOTP step.

**Pros**:
- Admins keep self service recovery.

**Cons**:
- An inbox takeover becomes a panel takeover, the exact failure spec 0004 designed against.

## Rationale

The engineer decided on full removal and explicitly accepted the password as the only factor (grilling session, 2026-10-27). Given that, Option 3 is the version of removal that loses the least. Options 1 and 2 keep the machinery the change exists to remove, and Option 2's security is only as strong as the least careful admin. Option 4 quietly reopens the inbox takeover path, which matters more once the password is the only lock: a password reset by email would make the inbox worth exactly as much as the password.

With one operator who already runs `admin:create` and `admin:disable` from the terminal, losing self service recovery costs almost nothing, and holding the production service role key becomes a practical second factor for password changes. The `password` amr rule closes the remaining gap left by removing `aal2`: a session made by verifying any email link can never open the panel, even if a future change starts sending admin links again.

Not ending sessions on reset was chosen in the grilling session: it avoids the app's only write to Supabase's internal `auth` schema, the 12 hour cap bounds any old session, and `admin:disable` cuts access on the very next request when an account is compromised. While building, the stack test showed that Supabase's admin password change deletes every session of the user anyway. So the script still writes nothing to `auth`, yet a reset now signs the admin out everywhere, and the 12 hour wait before re-enabling a compromised account is no longer needed.
