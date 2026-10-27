# Runbook: customer accounts in production

Spec: [0012](../specs/0012-customer-accounts/index.md). Customers sign up with their email, confirm it from a link, then choose a password. Every auth email (confirm sign up, reset password) leaves through the app's Send Email Hook and Resend, never through Supabase's own mailer.

These are recommendations for running things safely. Each step says why, so you can judge when to skip one. They are applied at deploy (scope feature 19); nothing here is needed before then.

## Production setup (once, before launch)

The production auth settings live in the Supabase dashboard, not in code, so they can drift from `supabase/config.toml`. This list is the record. Check it again after any Supabase dashboard change. The admin settings in [admin-accounts.md](admin-accounts.md) still apply.

### Supabase project: Authentication settings

- **Sign ups**: turn on "Allow new users to sign up". Customers need it; admins are still made only by `pnpm admin:create`.
- **Email confirmations**: turn on "Confirm email". Without it a sign up is active at once, and the customer never proves they own the inbox before choosing a password (AC-1 to AC-3).
- **Redirect URLs**: keep `https://<production domain>/**` and add `https://<production domain>/account/**`, so the forgot password redirect to `/account/set-password` is allowed.
- **Rate limits and link expiry**: keep Supabase's defaults. The local stack raises them only so e2e can run (AC-23, AC-26).

### Supabase project: the Send Email Hook

Supabase calls one URL for every auth email. Previews sit behind Deployment Protection and cannot take it, so only production (and local, and CI) has a hook.

1. Generate a secret: `echo "v1,whsec_$(openssl rand -base64 32)"`. Keep it in a password manager; it is shown once.
2. In Supabase, Authentication, Hooks, add a "Send Email" hook of type HTTPS: URL `https://<production domain>/api/auth/send-email`, secret the value from step 1.
3. In Vercel, set `SEND_EMAIL_HOOK_SECRET` to the same value for the production environment, then redeploy so the app reads it.
4. Check it: use "Forgot password?" on `/account/forgot-password` with your own customer email. The email should arrive within a minute, from `EMAIL_FROM`.

Why both sides hold the secret: the route answers 401 to anything not signed with it (AC-8), so nobody else can make the app send email. If you rotate it, change Supabase and Vercel together; in between, every sign up and reset fails.

### Vercel Firewall rule (AC-26)

Supabase sees every sign in, sign up and reset coming from Vercel's servers, so its per IP limits are shared by all customers. The Firewall rule is the real per IP guard.

- Rule: rate limit, condition "Request path starts with `/account/`, or is `/checkout/complete`" and "Method is `POST`" (the account forms and the confirmation page's "Create an account" button are server actions, so they all POST to their page).
- Limit: 20 requests per 60 seconds, keyed by IP.
- Action: deny, for 10 minutes.
- Apply it to the production environment and publish the change.

## Where to look when something goes wrong

- **No auth email arrives** (sign up or reset): for an admin email that is expected, the hook skips it on purpose and logs `auth_email.skipped` (spec 0019, AC-8). Otherwise the hook failed or never ran. The visitor still saw "Check your email", because Supabase runs after the reply. Look in Vercel logs for `auth_email.failed` (an error, with Resend's error name) and `auth_email.bad_signature` (the secret differs between Supabase and Vercel). Supabase's own Auth logs show `hook_failed` or `hook_timeout`. Resend or the app being down stops every sign up and reset until it recovers.
- **`account.email_conflict`** (an error): someone's account setup found another live account holding the same email. It should not happen; compare the two `customers` rows and their `auth.users` rows before changing anything.
- **`account.delete_incomplete`** (an error): a customer's login was deleted but the database commit failed after it. The leftover `customers` row has no login and is removed when that email signs up again; it can also be deleted by hand.
- Every account log line carries the customer id, order ids, counts and reason codes, never an email, name, phone, address, password, token, token hash or idempotency key.
