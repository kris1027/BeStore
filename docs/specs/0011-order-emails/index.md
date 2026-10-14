# 0011. Order emails

**Date**: 2026-10-13
**Status**: Accepted

## Summary

Customers get three kinds of email: a confirmation receipt when an order is paid, a notice when it ships, and one email per refund (worded "cancelled and refunded" when the order was cancelled). Each email is first written as a row in the database inside the same transaction as the order change (an "outbox"), then sent through Resend right after that change commits. A failed send is retried a few times on the spot, then once a day by the existing reconcile cron, and after 23 hours the store gives up and flags the order so an admin can press "Send again". Every email goes out at most once, because the row's key is unique and Resend refuses a second send with the same key.

## Requirements

**User stories**:
- As a customer, I want a receipt as soon as my payment goes through, so that I know the order is real and can check the items and address.
- As a customer, I want to hear when my order ships, with the carrier and tracking number when there is one, so that I know when to expect it.
- As a customer, I want an email for every refund, so that I know money is coming back and how much.
- As an admin, I want to see which emails went out for an order and send a failed one again, so that I can answer "I never got an email" without leaving the panel.

**Acceptance criteria**:

*What gets queued, and when*
- **AC-1**: When an order moves to `paid` (webhook, or the reconcile cron's replay, both through `handleStripeEvent`), the same transaction inserts one `email_sends` row: kind `order_confirmation`, key `order_confirmation:<orderId>`, status `pending`. This holds for orders flagged `needs_attention` on payment (stock shortfall, amount mismatch) too. A late payment on a `cancelled` or `expired` order (`flagLatePayment`) queues nothing.
- **AC-2**: When `markShipped` moves an order from `paid` to `shipped`, the same transaction inserts kind `order_shipped`, key `order_shipped:<orderId>`, with `ON CONFLICT (dedupe_key) DO NOTHING`. Undo then ship again, Edit tracking and Mark delivered queue nothing new, so a customer gets at most one shipped email per order.
- **AC-3**: When a refund first reaches `succeeded`, the same transaction inserts kind `order_refunded`, key `order_refunded:<refundId>`, `refund_id` set, `ON CONFLICT DO NOTHING`. This covers admin refunds, cancel refunds and system (Stripe dashboard) refunds, whether the success comes from Stripe's reply, the webhook or the refund sync. It is done inside `applyRefundOutcome` and `recordSystemRefund`, the only places a refund becomes `succeeded`, which already hold the order lock. The same insert sets `cancelled_wording = true` exactly when the order's status is `cancelled` and `refunded_cents`, after this refund is counted, equals `total_cents`; the wording is frozen there and never decided at send time. A `pending` or `failed` refund queues nothing. A refund that goes back to `succeeded` after a lost answer (spec 0010, AC-17) does not send twice. A refund that fails after its email went out sends no correction.

*What each email says*
- **AC-4**: The confirmation has the subject `Order #<number> confirmed`. Every email opens with "Hi <first word of `customer_name`>," or "Hello," when that is null. It shows the order number, the date paid (in `STORE_TIMEZONE`), every line (product name, variant label, quantity, unit price, line total), the subtotal, the discount when above 0 (labelled "Discount", amount only), the delivery fee ("Free" when 0), the total, the delivery address (when the order has one), and the line "We'll email you when your order ships."
- **AC-5**: The shipped email has the subject `Order #<number> is on its way`. It shows the line "Carrier: <carrier>, tracking number: <number>" with only the parts that are set (no line when neither is), the items (name, variant label, quantity) and the delivery address.
- **AC-6**: The refund email has the subject `Refund for order #<number>`. It shows the refunded amount, the refunded items (name, variant label, quantity) when the refund has lines, "Delivery fee refunded" when `includes_shipping` is true, and "Your bank usually shows the refund within 5 to 10 business days." When the row's `cancelled_wording` is true (AC-3), the subject is `Order #<number> cancelled and refunded` and the body opens with "Your order was cancelled and refunded in full." Otherwise the plain subject and body are used, also on a cancelled order with a partial refund. It never shows the admin's reason.
- **AC-7**: Every email is sent from `EMAIL_FROM`, with no separate Reply-To, so replies reach the sender mailbox. It shows `brand.name` as a text wordmark (no images, no product photos, no tracking pixel), has a plain text version beside the HTML (produced by React Email's `render(…, { plainText: true })` from the same component, never written by hand), links to no order page (the only guest order page takes a secret session id), and ends with "Questions? Reply to this email or write to <address of EMAIL_FROM>." Amounts use `formatMoney` with the order's `currency` and `STORE_LOCALE`. Dates use `formatDate` with `STORE_LOCALE` and `STORE_TIMEZONE`. The `<html lang>` is `STORE_LOCALE`, passed to the shared layout as a prop. Resend open and click tracking stay off.

*Delivery and retries*
- **AC-8**: Only after the transaction commits does the caller schedule delivery of the new rows through `after()`. The send never runs inside the transaction. Its failure never rolls back or fails the order change: the webhook still answers 200, and the admin action still returns its normal result. Delivery renders the email from the database at send time and calls Resend with the row's `dedupe_key` as the idempotency key. It tries up to 2 times in process: right away, then once more after 5 seconds, each call capped at 10 seconds (at most about 25 seconds of `after()` work). Success sets `status = sent`, `resend_id`, `sent_at`, and clears `error_code`.
- **AC-9**: Resend errors are sorted as follows. `validation_error` (an invalid recipient, for example) and any other 400 or 422 are final: the row becomes `failed` with the error name, and AC-11 applies. 401 or 403 (a bad key, an unverified domain) are config errors: the row stays `pending` with the error name, and an `email.config_error` log is written, so the sweep sends it once the config is fixed. 409 `invalid_idempotent_request` means Resend already accepted a send with this key: the row becomes `sent` with `resend_id` null and `error_code = idempotent_conflict`. 409 `concurrent_idempotent_requests`, 429, 5xx, a network error and a timeout all leave the row `pending` for the next try. Every try adds 1 to `attempts` and sets `last_attempt_at`.
- **AC-10**: There is no lease. Before each try, a worker reads the row and goes on only if it is `pending`. Every settle (`sent`, `failed`, attempts plus 1) is a guarded update `WHERE id = $1 AND status = 'pending'`, and zero rows means another worker settled it first. Two workers sending the same row at once is harmless: the shared `dedupe_key` makes Resend deliver once (a 409 `concurrent_idempotent_requests` just leaves the row `pending`).
- **AC-11**: The daily reconcile cron (`/api/cron/reconcile-orders`) starts with an email sweep. First it gives up: every `pending` row whose `queued_at` is 23 hours old or more becomes `failed` with `error_code = gave_up`. Then it tries once each, oldest `queued_at` first, at most 50 `pending` rows queued more than 2 minutes ago and not attempted in the last 2 minutes (so a row whose own `after()` is still running is left alone), within 10 seconds of the run's 50 second budget. It stops at the first 401, 403 or 429, leaving the rest `pending` for the next run. The existing order replay and refund sync then use what is left of that budget. Every write that flags an order here, or in AC-12, first takes the order lock (`lockOrderById`, spec 0010 order: order, then refund, then email row). When a row becomes `failed` (final refusal or gave up), the order gets `needs_attention` and a `note` event with `actor_type = system`: "The <confirmation | shipped | refund> email could not be sent. Use Send again on the order page." This is written once per row, and the flag is not set again when it is already on.
- **AC-12**: When the order's `email` is null at send time (purged under spec 0008, so only a refund on an expired order long after a late payment), the row becomes `failed` with `error_code = email_missing`. A `note` event is written, the order is not flagged, and `order.email_missing` is logged.

*Admin*
- **AC-13**: `/admin/orders/[number]` shows an "Emails" section listing each row, newest first: the kind ("Order confirmation", "Shipped", "Refund <amount>"), the status ("Sent <time>", "Sending" for pending, "Failed: <plain reason>"), and the attempt count. The plain reasons are "The address was refused" (`validation_error`), "The email service refused it (<error name>)" (any other final 4xx), "Gave up after 23 hours, it may have been sent" (`gave_up`) and "No email address on the order" (`email_missing`). A `pending` row with an `error_code` shows "Waiting to retry: <error name>", so a config error is visible. A `sent` row with `idempotent_conflict` shows "Sent". The page shows these words, never a raw `error_code` by itself. With no rows, it shows "No emails sent for this order."
- **AC-14**: A `failed` row (except `email_missing`) shows "Send again", which needs a confirm step. For `gave_up` the confirm warns: "This email may already have reached the customer. Sending again could deliver it twice." Every confirm also says: "If it was already delivered in the last 24 hours, it will not be sent again." Send again works in any order status. On confirm, `sendEmailAgain` sets the row back to `pending` with `queued_at = now()`, `last_attempt_at` and `error_code` cleared, and `attempts` kept. It writes a `note` event with `actor_type = admin` and the admin's id ("Order confirmation email queued again"), then schedules delivery through `after()` as in AC-8, and calls `revalidatePath` for the order page. A row that is no longer `failed` changes nothing and shows "This email changed. Reload to see the latest." It does not clear the order's flag; "Mark resolved" (spec 0010) still does that.
- **AC-15**: `sendEmailAgain` calls `requireAdmin()` itself. A visitor without an active admin at `aal2` gets the spec 0004 behaviour and nothing changes. The row must belong to the order named in the input, else `not_found`.

*Environments, logs, accessibility*
- **AC-16**: `EMAIL_TRANSPORT` picks `log` or `resend`. With `log`, nothing leaves the machine: delivery runs the same claim, render and status steps, marks the row `sent` with `resend_id` null, and logs `email.sent` with `transport: "log"`. The env schema refuses `log` when `VERCEL_ENV` is `production`, and requires `RESEND_API_KEY` when the transport is `resend`. The Vitest setup, the Playwright web server env and the CI workflow all set `EMAIL_TRANSPORT=log`. DB tests replace `scheduleDelivery` (no request scope for `after()`); e2e runs the real one under `next dev`. `pnpm email:dev` previews every template with fixture props.
- **AC-17**: Logs carry the email row id, kind, order id and number, refund id, attempts and the Resend error name. They never carry a recipient address, subject, body, name, delivery address or tracking number. Events: `email.queued`, `email.sent`, `email.retry` (warn), `email.failed` (warn), `email.gave_up` (error), `email.idempotent_conflict` (warn), `email.config_error` (error), `email.resend_requested`, `cron.email_sweep` (counts), `email.delivery_error` (error: a try that threw, such as a database error or a template bug; it carries the error name and SQLSTATE, and only the row id when the throw came before the row was read), and `order.email_missing` (reused).
- **AC-18**: The Emails section and the Send again dialog work by keyboard alone, move focus into the dialog and back out, and pass axe with zero violations (desktop and phone, same tags as spec 0003). Each email uses one column, real headings, layout tables marked `role="presentation"`, the line items as a data table with header cells, and text contrast of at least 4.5:1.

## Decision

**Chosen option**: Option 1: a transactional outbox (an email row written in the same transaction as the order change) sent after commit with `after()`, retried in process and by a daily sweep inside the reconcile cron, keyed once per email through `dedupe_key` and Resend's idempotency key.

The order change and the promise to email about it commit together, so an owed email is never lost and a rolled back change never emails. The send happens outside every transaction, so Resend being slow or down never touches money or order state.

**Implementation skills**: `resend` (`resend/resend-skills`, `.agents/skills/resend/`) · `react-email` (`resend/resend-skills`, `.agents/skills/react-email/`) · `email-best-practices` (`resend/resend-skills`, `.agents/skills/email-best-practices/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`)

**Decisions made in design (recommended picks, with runner up)**:
- **Outbox code lives in `src/lib/email/`**, because the orders feature (webhook, actions, refunds, cron) and the admin page all call it, and features must not import each other's internals. It holds `enqueue.ts` (insert in a caller's transaction), `deliver.ts` (claim, render, send, settle), `schedule.ts` (`scheduleDelivery(ids)`, the one `after()` call, a seam that tests replace), `sweep.ts`, `transport.ts` (log and Resend), `classify.ts` (pure, AC-9), and `content.ts` (loads an order or refund into plain template props). Templates live in the root `emails/` folder (spec 0001): `order-confirmation.tsx`, `order-shipped.tsx`, `order-refunded.tsx`, `components/layout.tsx`. Runner up: a `src/features/order-emails/` feature, which the orders feature could then not import.
- **Render at send time, from the database**, not stored HTML. No second copy of the address and items sits in `email_sends`, so the purge in spec 0008 stays the only PII cleanup. The cost: a retry after Edit tracking renders different content, and Resend answers 409 `invalid_idempotent_request`, which AC-9 treats as already sent (the first send carried the older tracking). Runner up: store the rendered HTML on the row, which is deterministic but duplicates PII.
- **New `queued_at` column** for the 23 hour window, because "Send again" restarts the window and `created_at` must not change. Runner up: reuse `updated_at`, which every status write also moves.
- **Sweep first in the reconcile run, with its own 10 second slice.** Emails the replay queues go out through that request's own `after()`, and the sweep can never be starved by a long order backlog. Runner up: a separate cron route, which is one more schedule and secret checked route for a few rows a day.
- **No claim lease.** Resend's idempotency key already makes two concurrent sends of one row deliver once, so guarded settles are enough. Runner up: a `last_attempt_at` lease, dropped after the cross check as the most error prone piece.
- **The sweep tries each row once per run, with no backoff.** The in process retry already covered short outages. A daily run with a 23 hour cutoff gives every failed email at least one sweep try only when it failed in the hours before the run, and that gap is accepted (see Consequences). Runner up: a 10 minute cron, declined because it needs Vercel Pro.
- **Copy in English**, like the rest of the storefront, with formats from `STORE_LOCALE`. Subjects and lines are fixed strings in the templates, not settings.
- **Packages**: `resend` and `react-email` (with `@react-email/components` if the installed `react-email` still splits them; follow the `react-email` skill), plus the `email:dev` script pointing at `emails/`.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

`email_sends` exists (spec 0002, RLS on). This feature adds columns only, in one additive migration:

| Column | Type | Null | Notes |
|---|---|---|---|
| id, order_id → orders (Cascade), kind `email_kind`, dedupe_key (unique), status `email_send_status` default `pending`, resend_id, sent_at, created_at, updated_at | | | existing |
| `refund_id` | uuid → refunds (Cascade) | yes | CHECK `(kind = 'order_refunded') = (refund_id IS NOT NULL)`; index |
| `attempts` | int default 0 | no | CHECK `attempts >= 0` |
| `last_attempt_at` | timestamptz(3) | yes | when the last try started; the sweep skips rows tried in the last 2 minutes |
| `cancelled_wording` | boolean default false | no | frozen at enqueue (AC-3); CHECK it is false unless `kind = 'order_refunded'` |
| `queued_at` | timestamptz(3) default now() | no | the 23 hour window starts here, reset by Send again |
| `error_code` | text | yes | Resend error `name`, or `gave_up`, `email_missing`, `idempotent_conflict`; never a message |

Plus a partial index `(queued_at) WHERE status = 'pending'` for the sweep. The migration also gives `id` a DB default (`uuidv7()` when the local and hosted Postgres have it, else `gen_random_uuid()`) and `updated_at` a default of `now()`, because the enqueue is a raw `INSERT … ON CONFLICT (dedupe_key) DO NOTHING RETURNING id` (a Prisma `create` would abort the transaction on a duplicate key, and raw SQL skips `@updatedAt`, so every raw update also sets `updated_at = now()`). Relationships: order 1:N email_sends (at most one confirmation, one shipped, one per refund); refund 1:0..1 email_send.

Dedupe keys keep spec 0002's format (`order_confirmation:<orderId>`, `order_shipped:<orderId>`, `order_refunded:<refundId>`) and are sent unchanged as Resend's idempotency key. `emails/AGENTS.md` uses the same format.

**State transitions** (`email_sends.status`):

```
(insert) ──▶ pending ──Resend accepted, or 409 invalid_idempotent──▶ sent
               │  ▲
               │  └── Send again (admin; not email_missing)
               ├──final 4xx, or queued 23h ago (sweep), or no email──▶ failed
               └──retryable error (429, 5xx, 401/403, network, timeout)──▶ pending (attempts + 1)
```

`sent` is terminal. Every move is a guarded update (`WHERE status = <from>`); zero rows means another worker moved it, so do nothing else.

**API surface**:

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `enqueueEmail(tx, { orderId, kind, refundId? })` | lib fn, in the caller's transaction | order id, kind, refund id for refunds | new row id, or null on conflict | server only | none (a conflict is a normal null) |
| `scheduleDelivery(ids)` | lib fn, after commit | row ids | none (runs `after(() => deliverAll(ids))`) | server only | never throws to the caller |
| `deliver(id)` | lib fn | row id | `sent \| retry \| failed \| skipped` | server only | Resend errors classified per AC-9; checks `email_missing` before loading any content |
| `sweepEmails(deadline)` | lib fn, called first in `reconcileOrdersRequest` | deadline | counts `{ gaveUp, sent, retry, failed, skipped }` | cron Bearer (existing route) | a row's thrown error is logged; counted as retry once the row was read (it stays pending), as skipped before |
| `sendEmailAgain` | server action, `src/features/orders/actions/emails.ts` | `orderNumber: int 1..2147483647`, `emailSendId: uuid` (Zod) | `{ status: "pending" }` | admin (`requireAdmin`) | `not_found`, `email_changed`, `invalid_input` |
| Resend `emails.send` | external | `from`, `to`, `subject`, `html`, `text`; option `idempotencyKey = dedupe_key` | `{ data: { id } }` or `{ error }` (the SDK does not throw) | `RESEND_API_KEY` | as AC-9 |
| Callers that enqueue | existing | | | | |
| `handleStripeEvent` (`pay` branch) | enqueue `order_confirmation`; after commit `scheduleDelivery` | | | | |
| `markShipped` action | enqueue `order_shipped` when moved; after commit schedule | | | | |
| `applyRefundOutcome`, `recordSystemRefund` | enqueue `order_refunded` on the move to `succeeded`; return the ids in their result | | | | |
| `refund-steps.ts`, `handleStripeEvent`, `refund-sync.ts` | schedule the ids those return, after their commit | | | | |

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| deliver | recipient | `orders.email` at send time (null → AC-12) |
| deliver | sender, contact address in the footer | `EMAIL_FROM`; the address part parsed by the env schema |
| deliver | idempotency key | `email_sends.dedupe_key` |
| deliver | store name | `brand.name` (`src/lib/brand/brand.ts`) |
| confirmation | number, date paid | `orders.number`, `orders.paid_at` formatted with `STORE_LOCALE`, `STORE_TIMEZONE` |
| confirmation | lines | `order_lines` snapshot (name, variant label, quantity, unit price, line total) |
| confirmation | subtotal, discount, delivery, total, currency | `orders.subtotal_cents`, `discount_cents`, `shipping_cents`, `total_cents`, `currency` |
| confirmation, shipped | delivery address | the `ship_*` columns through `withDeliveryAddress` (`src/lib/shipping/address.ts`); none → section left out |
| shipped | carrier, tracking number | `orders.carrier`, `orders.tracking_number` at send time |
| refund | amount, delivery included | `refunds.amount_cents`, `refunds.includes_shipping` |
| refund | items | `refund_lines.quantity` joined to `order_lines` (name, variant label) |
| refund | cancel wording | `email_sends.cancelled_wording`, set at enqueue from `orders.status` and `orders.refunded_cents` against `total_cents` |
| all | greeting name | first whitespace separated word of `orders.customer_name`; null → "Hello," |
| all | `lang` | `STORE_LOCALE`, passed to the layout as a prop |
| Emails section | kind label, refund amount | `email_sends.kind`; `refunds.amount_cents` through `refund_id` |
| Emails section | status, time, attempts, reason | `status`, `sent_at` (in `STORE_TIMEZONE`), `attempts`, `error_code` mapped to the AC-13 words |
| sendEmailAgain | admin name in the event | `requireAdmin()` |
| sweep | cutoff, batch, slice, quiet period | constants `EMAIL_GIVE_UP_MS` (23 h), `EMAIL_SWEEP_BATCH` (50), `EMAIL_SWEEP_BUDGET_MS` (10 s), `EMAIL_QUIET_MS` (2 min) in `src/lib/email/` |
| in process retry | waits, call timeout | constants `[0, 5_000]` ms, `EMAIL_SEND_TIMEOUT_MS` (10 s) |

**Key invariants**:
- At most one row per `dedupe_key` (unique), and a row is only ever inserted in the same transaction as the change it reports.
- No send runs inside a database transaction, and a send failure never changes order or refund state, except the AC-11 flag and note.
- A row leaves `pending` only through a guarded update (`WHERE status = 'pending'`). Concurrent sends of one row are allowed and made harmless by the shared idempotency key.
- A transaction that flags an order for an email failure locks the order first.
- Every send uses the row's `dedupe_key` as the idempotency key, so two sends within 24 hours deliver once. Rows are given up at 23 hours, inside that window. Only an admin's Send again can send after it.
- `refund_id` is set exactly on refund emails (CHECK).
- No email content is stored. Rendering reads the order at send time; the only frozen choice is `cancelled_wording`.

**Security model**:
- Customers have no surface: emails are only sent, never requested. Nothing in a webhook or form chooses the recipient. It is always the order's own `email`.
- `sendEmailAgain` and the Emails section are admin only (`requireAdmin()` in the action and on the page, spec 0004). Any active admin may send again. The `note` event records who did.
- PII (GDPR, an EU store): emails carry the customer's name, address and items to their own inbox. `email_sends` stores no PII, and logs never carry an address, subject or body (AC-17). Order confirmations are transactional, so no marketing consent or unsubscribe link applies. No link carries the checkout session id. Open and click tracking stay off.
- `RESEND_API_KEY` is a server only secret. `EMAIL_FROM` must be on a domain verified in Resend (SPF and DKIM set at the DNS host) before production.

**Configuration required**:
- `EMAIL_TRANSPORT`: `log` or `resend` (required; `.env.example` sets `log`; `resend` required when `VERCEL_ENV=production`).
- `RESEND_API_KEY`: required when `EMAIL_TRANSPORT=resend`, a sending only key (`re_...`).
- `EMAIL_FROM`: sender and reply mailbox, `Name <address>` or a bare address, for example `BeStore <orders@yourdomain.com>`. It must be monitored, since replies land there. The schema exposes the parsed address for the footer.
- Prerequisite before production: a Resend account, the sending domain verified (SPF, DKIM, a DMARC record), and the sending only key in Vercel's env.

**Critical test scenarios**:
- Happy path: a signed `checkout.session.completed` marks the order paid, and the same transaction holds a `pending` confirmation row. After commit, delivery with the log transport marks it `sent`. A duplicate event creates no second row. Verifies **AC-1**, **AC-8**, **AC-16**
- Rollback: a webhook transaction that throws after `markPaid` leaves no email row and schedules nothing. Verifies **AC-1**, **AC-8**
- Shipped once: ship, Undo, ship again, Edit tracking → one `order_shipped` row. Verifies **AC-2**
- Refund paths: an admin refund settled by reply, a dashboard refund by webhook, and a refund settled by the sync each queue one row with `refund_id`. A refund that is failed, then succeeded, then replayed still has one row. A cancel refund sets `cancelled_wording` and renders the cancel subject; a partial dashboard refund on a cancelled order does not. Verifies **AC-3**, **AC-6**
- Error classification (pure): 422 → final, 401 → config, 409 `invalid_idempotent_request` → sent, 409 concurrent, 429, 500, network, timeout → retry. Verifies **AC-9**
- Resend down: the stubbed transport fails twice → row `pending`, attempts 2. The webhook still answered 200. The sweep the next day sends it. Verifies **AC-8**, **AC-11**
- Give up: a `pending` row queued 23 hours ago → `failed`/`gave_up`, the order flagged with one note. A second sweep writes no second note. Verifies **AC-11**
- Settle race: two workers send the same row at once; one settle wins, the other updates zero rows and does nothing else. The sweep skips a row queued 1 minute ago. A 429 stops the sweep. Verifies **AC-10**, **AC-11**
- Purged email: a refund row on an order with a null email → `failed`/`email_missing`, no flag. Verifies **AC-12**
- Send again: a failed row goes back to pending and is sent, with a note naming the admin. A row already `sent` → `email_changed`. A row from another order → `not_found`. A non admin → spec 0004 behaviour. Verifies **AC-13**, **AC-14**, **AC-15**
- Templates: rendered HTML and text for each kind hold the AC-4, AC-5, AC-6 and AC-7 content and no order page link. Verifies **AC-4** to **AC-7**
- Env: `log` with `VERCEL_ENV=production` fails, and `resend` without a key fails. Verifies **AC-16**
- Logs: no recipient, subject or address in any `email.*` log line. Verifies **AC-17**
- E2E: the admin order page shows the Emails section, and Send again on a seeded failed row works by keyboard; axe passes. Verifies **AC-13**, **AC-14**, **AC-18**

## Build plan

Tracer Bullet: the first task drives one confirmation email through every layer (migration, env, outbox, transport, template, webhook, `after()`). Then each later task thickens one segment end to end.

1. [x] Thin thread: the migration (all new `email_sends` columns, CHECKs, partial index, the `id` and `updated_at` DB defaults), `EMAIL_TRANSPORT`/`RESEND_API_KEY`/`EMAIL_FROM` in `src/lib/env.ts` and `.env.example`, packages and the `email:dev` script, `src/lib/email/` (`enqueue` as a raw insert, `schedule`, `deliver` with guarded settle, both transports), `EMAIL_TRANSPORT=log` in the Vitest, Playwright and CI env, a bare confirmation template, and the enqueue plus `scheduleDelivery` in `handleStripeEvent`'s pay branch. A DB test runs from a paid event to a `sent` row. Satisfies **AC-1**, **AC-8**, **AC-10**, **AC-16**
2. [x] The full confirmation: the shared layout (wordmark, footer, plain text, `lang`, accessible tables), the content loader with `withDeliveryAddress`, the greeting, money and date formats, preview fixtures, and render tests. Satisfies **AC-4**, **AC-7**, **AC-18**
3. [x] Shipped: enqueue in `markShipped`, schedule after commit, the template, and DB tests for ship, Undo, ship again and tracking edits. Satisfies **AC-2**, **AC-5**
4. [x] Refunds: enqueue in `applyRefundOutcome` and `recordSystemRefund`, return the ids, schedule them in `refund-steps.ts`, `handleStripeEvent` and `refund-sync.ts`, the template with the cancel wording, and DB tests for every success path and the replay. Satisfies **AC-3**, **AC-6**
5. [x] Failure handling: `classify.ts` and its tests, the in process retry with its wait and timeout, `sweepEmails` first in the reconcile run with its slice and its stop on 401, 403 or 429, give up, flag and note once under the order lock, and `email_missing`. Satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**
6. [x] Admin: the Emails section on the order page, the `sendEmailAgain` action with its confirm dialog and the `gave_up` warning, and DB tests for the action's guards. Satisfies **AC-13**, **AC-14**, **AC-15**
7. [x] Safety net: the `email.*` log events and a log redaction test, e2e for the Emails section and Send again with axe (desktop and phone), and the orders and emails `AGENTS.md` facts handed to `/sync`. Satisfies **AC-17**, **AC-18**

## Consequences

**Positive**:
- An owed email is never lost and never sent for a change that rolled back, with no new infrastructure: one migration, one cron step, one SDK.
- Resend outages and slowness can't touch payments, refunds or the webhook's 200.
- Admins can see and fix "I never got the email" from the order page.

**Negative / tradeoffs**:
- A daily sweep is slow recovery. When Resend is down for longer than the in process retry (about 5 seconds), the email waits for the next daily run. Vercel Hobby fires a daily cron at any minute within its hour, so the run lands anywhere from 03:30 to 04:29, and an email that failed in the hour or two after a run can be given up at 23 hours without a sweep try. It then needs an admin's Send again. A 10 minute cron would fix this, but needs Vercel Pro.
- Send again after `gave_up` can deliver a duplicate (the admin is warned).
- Rendering at send time means a retry can carry newer tracking than the first try. Resend's 409 then counts it as sent, and the customer keeps the older version.
- `after()` work is lost if the function instance dies right after responding. The row stays `pending` and waits for the sweep (same slow recovery as above).
- No bounce or complaint handling: a hard bounce shows as "Sent".

**Neutral**:
- Spec 0010's attention banner gains a new kind of system note (email failures), and the reconcile cron gains a first step and a new log count.
- Test setup sets `EMAIL_TRANSPORT=log` and replaces `scheduleDelivery`, because `after()` needs a request scope.

## Follow-up

- [ ] Resend webhooks for `email.bounced` and `email.complained`: record them on `email_sends` and show "Bounced" on the order page, once the store is live.
- [ ] Move the email sweep to its own 10 minute cron when the project moves to Vercel Pro (feature 19, production deploy).
- [ ] Verify the sending domain in Resend (SPF, DKIM, DMARC) and set the production `EMAIL_FROM` and key before launch (feature 19).
- [ ] `/sync`: correct the idempotency key example in `emails/AGENTS.md` to the `dedupe_key` format, record `src/lib/email/` in root `AGENTS.md`, and remove the "joins when this area is built" comment in `src/lib/env.ts`.
- [ ] Order emails link to a customer order page once feature 12 (customer accounts) gives one that needs sign in.
- [ ] VAT invoices are out of scope. The confirmation is a receipt, not a tax invoice; revisit with the legal pages (feature 16) if invoices are required.
