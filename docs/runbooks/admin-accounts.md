# Runbook: admin accounts and admin sign in

Specs: [0004](../specs/0004-admin-sign-in/index.md), with [0019](../specs/0019-remove-admin-mfa/index.md). Admins sign in with email and password only; there is no authenticator step. There is no admin UI for accounts: the three `admin:*` scripts below are the whole lifecycle, and an admin password changes only through them.

These are recommendations for running things safely. Each step says why, so you can judge when to skip one.

## Production setup (once, before launch)

The production auth settings live in the Supabase dashboard, not in code, so they can drift from `supabase/config.toml`. This list is the record. Check it again after any Supabase dashboard change.

### Supabase project: Authentication settings

- **Sign ups**: on since customer accounts (spec 0012); see [customer-accounts.md](customer-accounts.md). Signing up never makes an admin: only `admin:create` adds an `admin_users` row. Keep the Email provider itself on (turning it off also blocks password sign in).
- **Passwords**: minimum length 8, required characters "lowercase, uppercase, digits and symbols". `passwordSchema` in `src/lib/auth/password.ts` mirrors this; keep the two in step. Admin passwords set by the scripts must also be at least 14 characters (`adminPasswordSchema`, spec 0019 AC-16).
- **MFA**: TOTP enroll and verify both **off** (spec 0019, AC-11). If any admin still has a factor from before spec 0019, delete it first (Authentication, Users, the admin, remove the factor; or `DELETE FROM auth.mfa_factors;` in the SQL editor), then turn TOTP off. Locally, `supabase/config.toml` already has it off; run the same `DELETE` against the local database (or reset the local stack) to clear old dev factors.
- **Site URL**: the production domain, the same value as `NEXT_PUBLIC_SITE_URL` (for example `https://shop.example.com`). Reset links always point here, so a reset started from a preview deploy lands on production. Test password reset locally, not on previews.
- **Redirect URLs**: `https://<production domain>/**`.
- **JWT signing keys**: switch to asymmetric keys, so `getClaims()` in the proxy verifies tokens locally without a network call.
- **Auth emails**: since spec 0012, Supabase hands every auth email to the app's Send Email Hook. Since spec 0019 the hook sends **nothing** for a password reset of anyone with an `admin_users` row (it answers 200 and logs `auth_email.skipped`), so an inbox alone can never change an admin password. The hook setup is in [customer-accounts.md](customer-accounts.md). **Check it after setup**: request a reset on `/account/forgot-password` for an admin email and confirm no email arrives. With the hook off, Supabase's default recovery email would reach the admin, and its link could set a new password through the Auth API directly.

### Vercel Firewall rule (spec 0019, AC-14): required before the first admin exists

The password is the only factor, and Supabase sees every sign in coming from Vercel's servers, so its per IP limit is shared by everyone. The Firewall rule is the real per IP guard. An admin password works on both sign in pages, and both sessions open `/admin`, so the rule covers both.

- Rule: rate limit, condition "Request path is one of `/admin/sign-in`, `/account/sign-in`" and "Method is `POST`".
- Limit: 10 requests per 60 seconds, keyed by IP.
- Action: deny, for 10 minutes.
- Apply it to the production environment and publish the change.

## Everyday tasks

The scripts read `.env.local` by default. To run against production, pull its variables into a separate file and pass it with `--env-file`, then delete the file:

```bash
vercel env pull --environment=production .env.production.local
pnpm admin:create --email owner@example.com --name "Store Owner" --env-file .env.production.local
rm .env.production.local
```

The file holds the service role key, which bypasses every Auth rule. Keep it on your machine only, and remove it when you are done.

### Add an admin

```bash
pnpm admin:create --email <email> --name "<name>"
```

It asks twice for a password (hidden, never a flag, so it stays out of shell history) of at least 14 characters that meets the policy above. Use a password manager to generate it. If an auth user with that email already exists (for example a customer), it keeps that user, sets the password you typed, confirms the email, and adds or re-enables the admin row. The password is always set, so a password someone planted through public sign up never becomes an admin password (spec 0019, AC-15).

Hand the password over directly (in person or through a password manager share, never plain email or chat).

### Disable an admin

```bash
pnpm admin:disable --email <email>
```

Their next request gets a 404. Their session cookie becomes useless and dies at the 12 hour cap. To re-enable them, run `admin:create` again with the same email (it asks for a password and sets it).

### Forgotten password

There is no self service reset for admins: the sign in page has no "Forgot password?" link, and the customer reset sends nothing to an admin. Reset it from the terminal:

```bash
pnpm admin:reset-password --email <email>
```

It finds the admin by email (enabled or disabled), asks twice for a new password of at least 14 characters, and sets it. Supabase's own auth audit log records the change. Confirm who you are talking to before you run it.

Changing the password through Supabase's admin API also **signs the admin out on every device**: Supabase deletes all of that user's sessions (the stack test in `tests/stack/admin-scripts.stack.test.ts` pins this).

### Compromised admin account

1. `pnpm admin:disable --email <email>`: every request from that account gets a 404 at once.
2. `pnpm admin:reset-password --email <email>`: the old password stops working, and every session made with it ends.
3. `pnpm admin:create --email <email> --name "<name>"` when you are ready to re-enable them (it sets a password again).

Because the password change ends every session, there is no need to wait for the 12 hour cap before re-enabling. If a future Supabase version stops ending sessions on a password change (the stack test would fail), wait 12 hours after step 2 before step 3.

## Where to look when something goes wrong

- Vercel logs: every auth event is one JSON line named `auth.*` (for example `auth.sign_in.failed` with a `reason`). Admins show as an id; unknown emails as a SHA-256 hash; never a password, code or token. An admin who signs in through `/account/sign-in` writes `account.*` events instead, not `auth.sign_in.*`.
- `auth_email.skipped` with `reason: "runs_the_store"`: someone asked for a password reset for an admin email. Expected if the admin tried it; worth a look if they did not.
- Supabase: Authentication, Logs, for Supabase's own audit trail.
