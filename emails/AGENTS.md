# Emails

## Overview

React Email templates for the customer emails (order confirmation, shipped, refunded), sent through Resend from server code. Empty until feature 11 (order emails) lands; the design is decided there.

## Conventions

- Templates are React components with named exports, rendered and sent only on the server. Each template also has a default export, which the React Email preview server needs; app code imports the named one.
- Sending happens after the work it reports is committed, and must be safe to retry: an email for one event goes out once.
  - Build the Resend idempotency key from the email type plus the order or event id (e.g. `order_confirmation:<orderId>`, spec 0011 AC-2), so different emails for one order never share a key.
  - Resend keeps idempotency keys for only 24 hours. Retries later than that must also check a durable record of sent emails in our DB.
- Auth emails (`confirm-signup.tsx`, `reset-password.tsx`) are not sent by Supabase templates: Supabase calls the Send Email Hook at `POST /api/auth/send-email` (`src/features/account/send-email-hook.ts`, signed with `SEND_EMAIL_HOOK_SECRET`), which picks the template and sends it through the app's transport within 4 seconds (spec 0012, AC-8). A store runner gets no reset email at all; their password changes only from the terminal (spec 0019, AC-8).
- `EMAIL_TRANSPORT` is `log` (unit tests), `mailpit` (local dev, e2e, CI; read the mail at `MAILPIT_URL`) or `resend`, the only one allowed when `VERCEL_ENV` is production.
- `RESEND_API_KEY` and `EMAIL_FROM` join the Zod schema in `src/lib/env.ts` when this area is built.

## Agent skills

- [resend](../.agents/skills/resend/): `resend/resend-skills`, sending, idempotency keys, webhooks
- [react-email](../.agents/skills/react-email/): `resend/resend-skills`, building and rendering templates
- [email-best-practices](../.agents/skills/email-best-practices/): `resend/resend-skills`, deliverability, accessibility, compliance

## Related specs

- [0001 Stack and architecture](../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
