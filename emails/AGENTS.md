# Emails

## Overview

React Email templates for the customer emails (order confirmation, shipped, refunded), sent through Resend from server code. Empty until feature 11 (order emails) lands; the design is decided there.

## Conventions

- Templates are React components with named exports, rendered and sent only on the server.
- Sending happens after the work it reports is committed, and must be safe to retry: an email for one event goes out once (use a Resend idempotency key tied to the order or event).
- `RESEND_API_KEY` and `EMAIL_FROM` join the Zod schema in `src/lib/env.ts` when this area is built.

## Agent skills

- [resend](../.agents/skills/resend/): `resend/resend-skills`, sending, idempotency keys, webhooks
- [react-email](../.agents/skills/react-email/): `resend/resend-skills`, building and rendering templates
- [email-best-practices](../.agents/skills/email-best-practices/): `resend/resend-skills`, deliverability, accessibility, compliance

## Related specs

- [0001 Stack and architecture](../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
