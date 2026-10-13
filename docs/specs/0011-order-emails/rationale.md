# 0011. Order emails: rationale

## Context

Customers pay, then hear nothing. Stripe receipts were turned off on purpose in spec 0006, so the store sends only one kind of email to its customers, and nothing sends it yet. Spec 0001 picked Resend and React Email for this. Spec 0002 already created `email_sends` with a unique `dedupe_key` and a send order (insert `pending`, send with the key, mark `sent` or `failed`). That table has never been used.

The events that trigger emails sit on the store's most careful code paths. The paid transition runs inside the Stripe webhook's transaction, next to the `stripe_events` dedupe insert. Refunds settle in three places (Stripe's reply, the webhook, the sync) through `applyRefundOutcome`. Shipping is an admin action under the order lock. Any of these can roll back, be replayed, or race. An email is a side effect that can't be undone: sending one for a change that rolled back, or sending it twice, is worse than sending it late.

The constraints: no deploys yet and no paid Vercel plan, so a cron runs at most once a day. Resend keeps an idempotency key for only 24 hours, and its SDK returns errors as values instead of throwing. The store is small (a few orders a day at first), single language, EU based (GDPR), with guests who have no order page except a confirmation URL whose session id works as a password.

## Options considered

### Option 1: Transactional outbox, send after commit, retry in process and in the daily cron

The transaction that changes the order also inserts the `email_sends` row. After commit, `after()` sends it with up to 2 quick tries. The daily reconcile cron sweeps what is left, and gives up at 23 hours so every automatic retry stays inside Resend's dedupe window. Admins can send a failed one again.

**Pros**:
- An email is owed exactly when its change committed, and never for a rolled back one.
- No new tools. It reuses `email_sends`, `after()` and the reconcile cron.
- Sending never holds a transaction or affects the webhook's answer.

**Cons**:
- Slow recovery on a daily cron, and a small gap where an email is given up without a sweep try.
- More code than a direct send: the claim, the sweep, and the admin retry.

### Option 2: Send directly after commit, insert the row as the send happens

After the order change commits, call Resend and write the row with the result.

**Pros**:
- The least code, and the email goes out as fast as Option 1's first try.

**Cons**:
- A crash or timeout between the commit and the send loses the email, with no record that it was owed.
- Retries have nothing to pick up.

### Option 3: Durable job tool (Vercel Queues, Vercel Workflow or Inngest)

Publish an event after commit (or from an outbox) to a durable queue that retries with backoff for days.

**Pros**:
- Real retries in minutes without a frequent cron, plus visibility into the queue.

**Cons**:
- A new service, SDK, local dev story and failure mode, for three email types and a handful of sends a day.
- The publish itself still needs an outbox to be safe against a crash after commit. That is Option 1's hardest part anyway.

## Rationale

Option 1 is the only one that gives both properties the context demands: no email for a change that did not commit, and no lost email for one that did. The insert in the same transaction makes the first true. The `pending` row plus the sweep makes the second true. The `dedupe_key`, also sent as Resend's idempotency key, turns every retry (in process, sweep, replayed webhook, racing workers) into "at most once". That holds as long as retries stay within 24 hours, which is why the automatic cutoff is 23 hours and anything later is a human decision.

Option 2 fails the "never lost" property at exactly the moment it matters (a function dying after commit), and spec 0002 already designed the outbox send order for that reason. Option 3 is what spec 0001 named as the later step if webhook retries plus a cron ever stop being enough. At this volume the daily cron with in process retries covers the common failure (a brief Resend blip), and its weak spot (a long outage) is visible on the order page and fixable with one click. The engineer chose a daily sweep over a 10 minute cron to stay on the free Vercel plan. That choice is sound for now, and the Follow-up moves the sweep to a frequent cron when the plan changes.

Rendering at send time instead of storing HTML keeps `email_sends` free of personal data, so the spec 0008 purge stays the only cleanup. The price is that a retry may carry newer tracking than the first try, which Resend's 409 handling settles safely.
