# Runbook: admin accounts and admin sign in

Spec: [0004](../specs/0004-admin-sign-in/index.md). Admins sign in with email, password and a TOTP code from an authenticator app. There is no admin UI for accounts: the three `admin:*` scripts below are the whole lifecycle.

These are recommendations for running things safely. Each step says why, so you can judge when to skip one.

## Production setup (once, before launch)

The production auth settings live in the Supabase dashboard, not in code, so they can drift from `supabase/config.toml`. This list is the record. Check it again after any Supabase dashboard change.

### Supabase project: Authentication settings

- **Sign ups**: turn off "Allow new users to sign up". Keep the Email provider itself on (turning it off also blocks password sign in).
- **Passwords**: minimum length 8, required characters "lowercase, uppercase, digits and symbols". `passwordSchema` in `src/features/admin-auth/schemas.ts` mirrors this; keep the two in step.
- **MFA**: TOTP enroll and verify both on.
- **Site URL**: the production domain, the same value as `NEXT_PUBLIC_SITE_URL` (for example `https://shop.example.com`). Reset links always point here, so a reset started from a preview deploy lands on production. Test password reset locally, not on previews.
- **Redirect URLs**: `https://<production domain>/**`.
- **JWT signing keys**: switch to asymmetric keys, so `getClaims()` in the proxy verifies tokens locally without a network call.
- **Email template, "Reset password"**: subject `Reset your admin password`, body copied from [supabase/templates/recovery.html](../../supabase/templates/recovery.html). The link must stay `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.

### Supabase project: custom SMTP through Resend

Supabase's built in mailer is for testing only, so password reset emails go through Resend.

1. In Resend, verify the sending domain (feature 11 reuses it for order emails).
2. In Supabase, Authentication, SMTP settings: host `smtp.resend.com`, port `465`, user `resend`, password a Resend API key with sending access, sender an address on the verified domain.
3. Until this is done, only the scripts can recover an admin.

### Vercel Firewall rule (AC-15)

Supabase sees every sign in coming from Vercel's servers, so its per IP limit is shared by all admins. The Firewall rule is the real per IP guard.

- Rule: rate limit, condition "Request path is one of `/admin/sign-in`, `/admin/mfa`, `/admin/forgot-password`" and "Method is `POST`".
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

It asks twice for a password (hidden, never a flag, so it stays out of shell history) that meets the policy above. If an auth user with that email already exists (for example a customer), it keeps that user and their password, confirms the email, and adds or re-enables the admin row.

**The enrollment window.** Until the new admin signs in for the first time, whoever holds the password can set up the authenticator. So hand the password over directly (in person or through a password manager share, never plain email or chat), and ask them to sign in soon. At the first sign in they scan a QR code and type a code, and from then on every sign in needs it.

### Disable an admin

```bash
pnpm admin:disable --email <email>
```

Their next request gets a 404. Their session cookie becomes useless and dies at the 12 hour cap. To re-enable them, run `admin:create` again with the same email (it keeps their password).

### Lost authenticator

```bash
pnpm admin:reset-mfa --email <email>
```

This deletes their TOTP factors and every session, so every device is signed out. At their next sign in they set up the authenticator again, which reopens the enrollment window above: confirm who you are talking to before you run it, and ask them to sign in right away.

### Forgotten password

The admin uses "Forgot password?" on the sign in page. The link asks for their authenticator code before it lets them set a new password, so an inbox alone is not enough.

An admin who never set up an authenticator cannot reset this way (a reset link may verify a factor, never create one). They have not finished their first sign in yet, so the simplest fix is to agree a new first password with them. There is no script for that yet; if it comes up, it is worth a small `admin:set-password` script rather than a dashboard workaround.

## Where to look when something goes wrong

- Vercel logs: every auth event is one JSON line named `auth.*` (for example `auth.sign_in.failed` with a `reason`). Admins show as an id; unknown emails as a SHA-256 hash; never a password, code or token.
- Supabase: Authentication, Logs, for Supabase's own audit trail.
- "Too many incorrect codes": 5 wrong codes for one account in 15 minutes lock the code step for that account, from any device. It unlocks on its own after 15 minutes. If the admin did not type those codes, their password has leaked: have them reset it.
