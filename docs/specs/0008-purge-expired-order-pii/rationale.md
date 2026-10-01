# 0008. Purge personal data from expired orders: rationale

Decision record for [index.md](index.md).

## Context

Since spec 0006, pressing Pay freezes the cart into a `pending_payment` order before Stripe is called. Since spec 0007 that order also holds the delivery address and phone, next to the email collected in spec 0006. When the customer abandons the Stripe page, or a delayed payment fails, the webhook or the reconcile cron moves the order to `expired`, a terminal state. The row then sits in `orders` forever, still holding the email, name, phone and full address of someone who never bought anything.

The store sells in the EU, so GDPR applies. Its storage limitation principle says personal data is kept no longer than its purpose needs. A paid order must keep its data for accounting and delivery. An expired order has no accounting purpose, because no money moved. Its only uses are short lived: prefilling the form when the same browser returns (spec 0007, AC-9), and helping a customer whose payment failed. The privacy policy (feature 16, not yet built) will have to say how long this data is kept, and that promise needs a mechanism behind it.

Forces at play. `orders.email` is `NOT NULL` today, and spec 0002 treats "an email on every order" as an invariant. The admin list and detail pages, the checkout prefill and the confirmation page all read these columns. Some expired orders carry `needs_attention` (an amount mismatch or a payment that may have moved money), and the admin may need the Stripe trail for them. The project already runs two daily Vercel crons with a shared constant time bearer check (`isCronRequest`), and `AGENTS.md` keeps every schedule in `vercel.json`. Stripe keeps its own copy of the customer details on the Checkout Session.

Without this, personal data from every abandoned checkout accumulates with no end date, the privacy policy cannot state a retention period truthfully, and the gap was already flagged as a consequence in spec 0007.

## Options considered

### Option 1: Daily cron blanks the personal data columns in place

A route under `app/api/cron/` runs daily, finds `expired` orders older than the retention period, and sets the personal data columns and the person links to null in batches, stamping `pii_purged_at`. Database CHECKs make purging anything other than an expired order impossible.

**Pros**:
- The order row, its number, lines, totals and Stripe ids stay, so abandoned checkout counts and the Stripe trail for flagged orders survive.
- Same shape as the expired carts cron: batched raw SQL, `isCronRequest`, a count log. Nothing new to learn or operate.
- The database guards the one rule that matters most (never purge a paid order).

**Cons**:
- `orders.email` becomes nullable, so every reader must handle a null that only purged rows can hold.
- One more cron to keep healthy.

### Option 2: Daily cron deletes expired orders outright

Same cron, but `DELETE FROM orders WHERE status = 'expired' AND expired_at < cutoff`; lines, events and email sends cascade.

**Pros**:
- Simplest possible privacy story: the data is gone, nothing to blank, no new column, `email` stays `NOT NULL`.
- No reader changes at all.

**Cons**:
- Loses the Stripe session and payment intent ids of a flagged expired order, which is exactly the case where money may have moved and an admin needs to trace it.
- Loses abandoned checkout history that the sales dashboard (feature 15) could use for a conversion figure.
- Order numbers then have unexplained gaps with no row to explain them.

### Option 3: Never keep personal data on unpaid orders

Store the address and email on the pending order only in a short lived side table (or only at Stripe) and copy them onto the order when the webhook marks it paid.

**Pros**:
- Expired orders never hold personal data in the first place, so no purge job.

**Cons**:
- Reverses decisions in specs 0006 and 0007: the pending order is the frozen record Stripe charges against, and the prefill reads it.
- The webhook gains a copy step inside the money transaction, a new failure point on the most critical path.
- The side table still needs its own expiry, so the cron does not really go away.

### Option 4: A `pg_cron` job inside Postgres

Schedule the same `UPDATE` with Supabase's `pg_cron` extension instead of a Vercel cron route.

**Pros**:
- No HTTP route, no secret; it runs even if the app is down.

**Cons**:
- The logic lives in the database, outside the TypeScript code, tests, logs and `vercel.json` where `AGENTS.md` keeps every schedule.
- A second scheduler to know about, monitor and migrate.

## Rationale

The privacy goal is to remove what identifies a person, not to remove the record that a checkout happened. Option 1 does exactly that and keeps what the store still has a legitimate need for: the Stripe ids of a flagged order, and an honest count of abandoned checkouts. Option 2 is simpler, but it throws away the trail for the one kind of expired order that may hide a real payment, and that trade is wrong for a store that takes money. Option 3 fixes the root cause on paper, but it reopens two shipped decisions and puts new work inside the paid transaction, the place where a bug costs the most. Option 4 gives up the project's single place for schedules and its tested code path for no real gain at this volume.

The cost of Option 1 is the nullable email. It is contained by making the database state the real rule ("present unless purged") with a CHECK, and by having code treat a null email on any order that is not purged as a bug. The engineer chose 30 days because it matches the cart lifetime and leaves a month for support, a code constant because the number is a published promise that should change only through review, purging flagged orders too because nothing can clear a flag yet and retention should hold for everyone, and nulling the cart and customer links so the prefill and future account pages can never reach a purged row. Leaving Stripe's copy out of scope keeps this feature to BeStore's own database; the privacy policy will name Stripe as a processor with its own retention.
