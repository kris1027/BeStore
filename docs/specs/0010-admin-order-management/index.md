# 0010. Admin order management: statuses, refunds and restock

**Date**: 2026-10-05
**Status**: In Progress

## Summary

This spec lets admins run orders after payment. They can find any order (search plus filters), move it through shipped and delivered (with one step undo), cancel it, add notes, clear the "needs attention" flag, and refund all or part of it through Stripe. They can also put the refunded items back in stock. Cancelling a paid order always refunds what is left, so a cancelled order never still holds the customer's money. Refunds made in the Stripe dashboard flow in through the webhook, so the store's refund total always matches Stripe. Every change lands in the order history with the admin who made it and their reason.

## Requirements

**User stories**:
- As an admin, I want to find any order by number, email or name, and narrow the list by status, flag, refund state and date, so that I can answer a customer or work through a backlog quickly.
- As an admin, I want to mark orders shipped and delivered (and undo a wrong click), so that the order shows where the parcel is.
- As an admin, I want to refund all or part of an order through Stripe and choose which items go back in stock, so that returns and goodwill refunds need no trip to the Stripe dashboard.
- As an admin, I want cancelling a paid order to refund it in full, so that status and money never disagree.
- As an admin, I want a history of who changed what and why, so that another admin can pick up any order.

**Acceptance criteria**:

*Finding orders*
- **AC-1**: `/admin/orders` has one search box (`q`). An all digits query between 1 and 2147483647 matches the order with that exact number (a larger one skips the number match). Any query also matches, case insensitively and as a substring, the order email, `customer_name` and `ship_full_name`. `%`, `_` and `\` in the query are matched literally. A query longer than 100 characters is cut to 100.
- **AC-2**: The list filters by status (`status=paid|shipped|delivered|cancelled|pending_payment|expired|all`). With no status, it shows the settled set (paid, shipped, delivered, cancelled), as today. It also filters by needs attention (`attention=1`), refund state (`refund=none|partial|full`, from `refunded_cents` against `total_cents`) and date placed (`from`, `to` as `YYYY-MM-DD`, both inclusive, as whole days in `STORE_TIMEZONE`, applied to `created_at`). Filters combine with AND, live in the URL (so a filtered view can be shared or reloaded), and survive paging. An invalid value for any parameter is ignored, never an error: an unknown status, a date that is not a real calendar day (2026-02-30), and a `from` later than `to` (both dates ignored). The old `?view=all` link keeps working as `status=all`.
- **AC-3**: Results stay newest first, 50 per page, keyset paged on the order number as today. With no matches, the list shows "No orders match these filters." and a "Clear filters" link.

*Status changes*
- **AC-4**: On a `paid` order, "Mark shipped" takes an optional carrier and an optional tracking number (each trimmed, at most 100 characters, empty saved as null). It moves the order to `shipped`, sets `shipped_at`, and writes a `status_changed` event naming the admin, whose message is `Carrier: <carrier>, tracking: <number>` with the parts that were given (null when neither was).
- **AC-5**: On a `shipped` order, "Mark delivered" moves it to `delivered`, sets `delivered_at`, and writes a `status_changed` event.
- **AC-6**: "Undo" moves `shipped` back to `paid` (clearing `shipped_at`, keeping carrier and tracking so shipping again prefills them) or `delivered` back to `shipped` (clearing `delivered_at`). It needs a reason, written to the event's message. No other backwards move exists.
- **AC-7**: On a `shipped` or `delivered` order, "Edit tracking" changes the carrier and tracking number and writes a `tracking_updated` event whose message gives the old and the new values (`Carrier: A → B, tracking: X → Y`, only the parts that changed). A save that changes nothing is refused with "Nothing changed."
- **AC-8**: Any status action whose order is no longer in the status the action expects (or that changed since the admin loaded the page) changes nothing and shows "This order changed. Reload to see the latest." Only `paid` (and `pending_payment`, AC-15) orders can be cancelled. A lost or returned parcel on a `shipped` or `delivered` order is handled as a refund (AC-9, with restock when the goods came back), and the status stays where it is. Delivered, cancelled and expired orders take no status action except the undo in AC-6. Every status and refund action locks the order row (`SELECT … FOR UPDATE`), then checks `updated_at`, the in flight rule (AC-18) and the status, before its guarded update.

*Refunds*
- **AC-9**: On a `paid`, `shipped`, `delivered` or `cancelled` order with money left to refund (`remaining > 0`, see *Refund math*), "Refund" opens a form. (On `cancelled` this covers a cancel refund that later failed.) It lists each line with how many units are still refundable and a quantity input. It has a "Refund delivery" checkbox, shown only while no refund that did not fail has already included delivery. It also has an amount field (in currency units, converted on the server to integer cents with 2 decimals for `STORE_CURRENCY`) and a required reason. Each line with a quantity above 0 also has a "Return to stock" checkbox, unticked by default. The amount prefills with the suggestion (see *Refund math*) and may be lowered. With no lines and no delivery chosen, it is a goodwill refund, and any amount up to the remaining refundable is allowed.
- **AC-10**: Before anything reaches Stripe, a confirm step repeats the amount, the lines, the restock choices and the reason. On confirm, the store records a `pending` refund with its lines, then asks Stripe to refund that amount on the order's payment, using the refund id as the idempotency key. Stripe's answer settles it at once: `succeeded` marks the refund succeeded and adds it to `refunded_cents`; `failed` or `canceled` marks it failed; `pending` or `requires_action` leaves it pending. Events written: `refund_created`, then `refund_succeeded` or `refund_failed`.
- **AC-11**: A refund never makes the reserved total (succeeded plus pending refunds) exceed `total_cents`. No line's refunded quantity (over refunds that did not fail) ever exceeds its `quantity`. An amount below 1 cent, above the cap, or a reason that is empty or longer than 500 characters is refused with a field error and nothing reaches Stripe.
- **AC-12**: When Stripe refuses the request, the refund is marked `failed` with Stripe's message in the `refund_failed` event. A refusal is a 4xx error the request could not have survived: `StripeInvalidRequestError`, `StripePermissionError`, `StripeAuthenticationError`, `StripeCardError`, `StripeIdempotencyError`. The order is unchanged, and the admin sees "Stripe refused the refund: <Stripe message>". Every other outcome means the refund may exist: `StripeAPIError` (5xx), `StripeRateLimitError`, `StripeConnectionError`, or a timeout after the SDK's own retries (`maxNetworkRetries: 2`, the SDK default timeout). Then the refund stays `pending`. The admin sees "Stripe did not answer. The refund is being checked." and the refund sync (AC-17) settles it later.
- **AC-13**: A line marked "Return to stock" goes back to stock only when its refund becomes `succeeded`, in the same transaction. The quantity returned is capped at what the sale really took for that line minus what earlier refunds already returned (a shortfall line returns only what was taken). Each return writes a `return` stock movement naming the refund's admin. When two order lines share a variant, the cap is shared and handed out lowest order line first. A refund line becomes `restocked = true` only when more than 0 units came back. When fewer units came back than requested (0 included, e.g. an order paid before spec 0009 has no sale movement), a `note` event records "Returned N of M to stock for <sku>". The refunds section shows returned and requested counts (returned is read from the `return` movements). The form warns when a chosen quantity is above what can go back. The storefront catalog cache for the affected products is expired. A refund that never succeeded never restocks. A line whose variant was deleted is skipped with a `note` event.

*Cancelling*
- **AC-14**: On a `paid` order, "Cancel and refund" needs a reason and shows a confirm step. The step lists every remaining refundable unit with "Return to stock" ticked by default, and the full remaining amount (not editable). The refund lines are every refundable unit of every line, with `restock` true only on the ticked lines. The amount is always `remaining`, even when a goodwill refund made it smaller than the lines' value, and delivery counts as included. On confirm, the same transaction that reserves the refund (AC-10) moves the order to `cancelled`, sets `cancelled_at` and writes a `status_changed` event. So a crash during the Stripe call leaves a cancelled order with a pending refund that the sync settles, never a paid order with the money gone. If Stripe then refuses, the refund is marked failed and the order goes back to `paid` (`cancelled_at` cleared, a `status_changed` event "Cancel undone: Stripe refused the refund"). The admin then sees the AC-12 message. If nothing is left to refund, it cancels without calling Stripe.
- **AC-15**: On a `pending_payment` order, "Cancel order" (with a reason) first asks Stripe for the session. `open` → expire it, then cancel. `expired` or no session → cancel. `paid`, `processing` or `unknown` → refuse with "A payment is in progress for this order. Wait for it to settle." If expiring fails, retrieve the session again: cancel only when `sessionState` now says `expired`, else refuse the same way. If Stripe cannot be reached, the order is unchanged and the admin sees "Stripe did not answer. Try again." Cancelling deletes the order's discount redemption (spec 0002). If a paid event still arrives for an order that is no longer `pending_payment`, `markPaid` changes nothing as today. The handler then sets `needs_attention` and writes a `note` event ("Payment received after the order left pending; refund it"), so the money is never silently kept.

*Stripe side refunds and sync*
- **AC-16**: The Stripe webhook handles `refund.created`, `refund.updated` and `refund.failed`, deduplicated through `stripe_events` like checkout events. The event's refund is matched to a row by `stripe_refund_id` first, then by our `metadata.refund_id`. With no match, a refund on a payment that belongs to one of our orders is recorded as a `system` refund (amount and reason, no lines, no restock) in whatever state Stripe reports (a failed one is recorded as failed and never counted), and counts toward `refunded_cents` once it succeeds. A refund on a payment that belongs to no order answers 200 and changes nothing. The outcome rules are in *Refund outcomes*. Every one of them answers 200 once applied, including the over total case, so Stripe never retries forever.
- **AC-17**: A refund that was `pending` and then fails (by webhook or sync) is marked `failed`, its amount is never counted, and its lines are never restocked. The order gets `needs_attention` and a `refund_failed` event. A cancelled order stays cancelled, but flagged, and can be refunded again (AC-9). A refund that had `succeeded` and then fails (Stripe allows this, e.g. a closed card) is marked `failed` with `succeeded_at` cleared and its amount subtracted from `refunded_cents`. The order is flagged, and stock it returned stays (the event says so; the admin adjusts stock by hand if needed). A refund that the store marked `failed` but Stripe reports `pending` or `succeeded` (a request whose answer was lost) goes back to `pending` or `succeeded` (counted, restocked), and the order is flagged. The daily reconcile cron, and a "Check with Stripe" button on any order with a pending refund older than 2 minutes, run the same refund sync. With a Stripe refund id, the sync retrieves the refund and applies its status. Without one, it lists the payment's refunds (following pagination) and matches `metadata.refund_id`. If nothing matches, the row stays pending until it is 24 hours old (Stripe's idempotency key window). After that it is marked `failed` with "Request never reached Stripe". The cron syncs at most 100 pending refunds per run, oldest first, inside the run's existing time budget. One refund's error is logged and counted as skipped, and the run continues. A flag already set is not set again, and an event with the same message is not written twice for the same refund.
- **AC-18**: While an order has a pending refund with no Stripe refund id that is younger than 10 minutes (a request in flight), every refund and status action on it (including Edit tracking and Mark resolved) is refused with "A refund is in progress for this order." Notes stay allowed.

*Notes, flag and history*
- **AC-19**: Any admin can add a note (1 to 1000 characters) to any order, in any status. It is shown in the history as a `note` event with the admin's name.
- **AC-20**: On an order with `needs_attention`, "Mark resolved" needs a note. It clears the flag and writes an `attention_cleared` event with that note.
- **AC-21**: The order page shows the refund state badge (none, partly refunded, fully refunded), the refunded amount, and for each pending refund a "Refund pending: <amount>" notice (also on a cancelled order). It shows a refunds section (amount, status, who, reason, lines with quantities and whether each was restocked). It shows the history newest first, each entry with time in `STORE_TIMEZONE`, actor (admin name, "Stripe" for system, "Customer") and message. It offers only the actions the order's current status allows.

*Security, logs, accessibility*
- **AC-22**: Every new action and the refund sync button call `requireAdmin()` themselves. A visitor without an active admin at `aal2` gets the spec 0004 behaviour (404 or redirect to MFA) and nothing changes. Amounts are always computed on the server from the order's rows. The client's amount is only checked against them, never trusted to widen a cap.
- **AC-23**: Each action and webhook path logs the events in *Observability* with the order id and number, refund id and amounts. It never logs an email, name, address, reason, note, tracking number or card detail.
- **AC-24**: The list filters, the action forms and the confirm dialogs work by keyboard alone, label every field, link errors to their fields, move focus into a dialog and back out, and axe reports zero violations on the list and order pages (desktop and phone, same tags as spec 0003).

## Decision

**Chosen option**: Option 1: admin actions on the existing order pages, refunds reserved in the database first and then created in Stripe with the refund id as the idempotency key, Stripe's reply settles them at once, and the webhook plus a sync confirm or correct them.

Admin server actions in `src/features/orders/` drive guarded status transitions in `src/lib/orders/transitions.ts` and a refund flow that never holds a database lock across a Stripe call. Refund events from Stripe go through the same `handleStripeEvent` path as checkout events.

**Implementation skills**: `stripe-best-practices` (`stripe/ai`, `.agents/skills/stripe-best-practices/`) · `stripe-docs` (`stripe/ai`, `.agents/skills/stripe-docs/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`)

**Decisions made in design (recommended picks, with runner up)**:
- **Refund in three steps, no lock across Stripe**: transaction 1 locks the order, checks it, and inserts the `pending` refund (the pending amount reserves the money, so a second admin cannot double refund). Then the Stripe call. Then transaction 2 applies the answer. Runner up: calling Stripe inside the locked transaction, which holds a row lock for a network round trip and leaves the database out of step when the process dies after Stripe said yes.
- **Stale form check through `orders.updated_at`**: every form carries the `updated_at` it was rendered with (ISO string, millisecond precision like the `timestamptz(3)` column), and every action compares it under the lock. Every writer of an order row sets `updated_at = now()`: admin actions except `addNote`, `applyRefundOutcome`, system refunds, the sync, flag changes, and the raw SQL in `markPaid`/`markExpired` already does. Raw SQL never runs Prisma's `@updatedAt`, so each statement sets it itself. Runner up: only status guards, which miss "another admin refunded meanwhile" when the status did not change.
- **Refund sync lives in the reconcile cron plus a button**: no new cron and no new schedule. Runner up: a separate refunds cron, which is one more secret checked route for the same work.
- **Search with plain `ILIKE ... ESCAPE '\'` through `$queryRaw` for the matching order ids (or a verified escaping `contains`), no index**: a small store reads a few thousand orders at most. Runner up: `pg_trgm` GIN indexes, worth adding only once the list is measured as slow (Follow-up).
- **Admin transitions join `markPaid` and `markExpired` in `src/lib/orders/transitions.ts`**: that file stays the only code that changes `orders.status`. Runner up: keeping them inside the orders feature, which splits the one place a reader checks for status writes.
- **Stripe refund status mapping**: `succeeded` → succeeded; `failed`, `canceled` → failed; `pending`, `requires_action` → pending; any other value → pending plus `needs_attention` (a status newer than the pinned API version). Same idea as `sessionState`, never guess.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Code layout

| Path | What |
|---|---|
| `src/features/orders/admin-queries.ts` (extend) | `parseAdminOrdersParams` gains `q`, `status`, `attention`, `refund`, `from`, `to`; `getAdminOrders` applies them; `getAdminOrder` adds refunds with lines, `updatedAt`, remaining refundable per line, and the allowed actions |
| `src/features/orders/order-actions.ts` (new, pure) | `allowedActions(order)`: which actions a status, refund state and in flight refund allow (AC-8, AC-18, AC-21) |
| `src/features/orders/refund-math.ts` (new, pure) | suggestion, caps, remaining refundable units per line, restock cap (see *Refund math*) |
| `src/features/orders/schemas.ts` (new) | Zod schemas for every action input |
| `src/features/orders/admin-actions.ts` (new, `"use server"`) | `markShipped`, `markDelivered`, `undoStatus`, `editTracking`, `refundOrder`, `cancelOrder`, `addNote`, `resolveAttention`, `checkRefundWithStripe` |
| `src/features/orders/refunds.ts` (new, server only) | `reserveRefund` (transaction 1), `requestStripeRefund`, `applyRefundOutcome` (transaction 2 and the webhook, idempotent from `pending`), `restockRefund`, `syncPendingRefunds` |
| `src/features/orders/event-decision.ts` (extend) | the three `refund.*` types and `refundOutcome(status)`, pure |
| `src/features/orders/stripe-events.ts` (extend) | dispatch refund events to `applyRefundOutcome` / system refund insert |
| `src/features/orders/reconcile.ts` (extend) | calls `syncPendingRefunds` after the order replay, same failure isolation |
| `src/features/orders/components/` | `orders-filters.tsx`, `order-actions-panel.tsx`, `ship-form.tsx`, `tracking-form.tsx`, `refund-form.tsx`, `cancel-dialog.tsx`, `reason-dialog.tsx`, `note-form.tsx`, `refunds-section.tsx`, `refund-state-badge.tsx`, extended `admin-order-detail.tsx` history |
| `src/lib/orders/transitions.ts` (extend) | `markShipped`, `markDelivered`, `revertShipped`, `revertDelivered`, `markCancelled` (from `paid` or `pending_payment`), `revertCancelled` (cancel refund refused), each guarded by its from status; `markPaid` on a non pending order now flags it (AC-15) |
| `src/lib/stock-movements.ts` (extend) | `MovementRow` gains the `return` kind (order id and admin id required) |
| `app/admin/(panel)/orders/page.tsx`, `[number]/page.tsx` | stay thin, pass search params and render the feature components |

### Data model sketch

One feature, two migrations (Postgres refuses to use a new enum value in the transaction that adds it, and the CHECKs name `return`), plus the matching `schema.prisma` changes (the three enum values, `RefundLine.restock`, `Refund.includesShipping`):

1. `..._order_management_enums`: `ALTER TYPE stock_movement_kind ADD VALUE 'return'`; `ALTER TYPE order_event_type ADD VALUE 'tracking_updated'`; `ALTER TYPE order_event_type ADD VALUE 'attention_cleared'`.
2. `..._order_management`:
   - `refund_lines.restock boolean NOT NULL DEFAULT false` (what the admin asked for); `restocked` stays (done, more than 0 units returned). CHECK `NOT restocked OR restock`.
   - `refunds.includes_shipping boolean NOT NULL DEFAULT false` (this refund included delivery; system refunds are false).
   - `stock_movements`: drop `stock_movements_sale_order_check` and add `stock_movements_order_check CHECK ((kind IN ('sale','return')) = (order_id IS NOT NULL))`; add `stock_movements_return_actor_check CHECK (kind <> 'return' OR actor_type = 'admin')`. The existing `stock_movements_note_check` already forbids a note on a `return` row.

No new tables, no new columns on `orders`. Columns this feature fills that already exist: `orders.tracking_number`, `carrier`, `shipped_at`, `delivered_at`, `cancelled_at`, `refunded_cents`, `needs_attention`, `updated_at`; `refunds.*`; `refund_lines.*`; `order_events.*`. RLS is already enabled on every touched table.

Relationships (unchanged): order 1:N refunds 1:N refund_lines N:1 order_line; order 1:N order_events N:1 admin_user (optional); `return` stock movement N:1 order, N:1 variant, N:1 admin_user.

### State transitions

```
pending_payment ──webhook──▶ paid ──Mark shipped──▶ shipped ──Mark delivered──▶ delivered
       │                      ▲  │                   │  ▲                           │
       │                      │  │                   │  └──────────Undo─────────────┘
       │                      │  │                   │
       │                      └──┼───────Undo────────┘
       │                         │
       │                         └──Cancel and refund──▶ cancelled ──Stripe refused the cancel refund──▶ paid
       └──Cancel order (session not live)──▶ cancelled
```

- `cancelled → paid` happens only inside `cancelOrder`, when Stripe refuses the refund reserved in the same cancel (AC-14). Nothing else leaves `cancelled`.

- Each transition is a guarded `UPDATE ... WHERE id = $1 AND status = <from>`. Zero rows means another path moved it, which the action reports as AC-8.
- `cancelled`, `expired` are terminal. `delivered` only goes back to `shipped` by Undo.
- Refunds are not a status (spec 0002). Refund allowed on `paid`, `shipped`, `delivered` while reserved < total.
- **Refund** (`refunds.status`): `pending → succeeded | failed` normally. Stripe can also move `succeeded → failed`, and a lost answer can reveal `failed → pending | succeeded` (see *Refund outcomes*). Succeeded sets `succeeded_at` (the Stripe event's `created` time on the webhook path, else `now()`) and adds `amount_cents` to `orders.refunded_cents` in the same transaction, then restocks.

### Refund flow (action, webhook and sync share `applyRefundOutcome`)

1. `requireAdmin()`; Zod parse; then **transaction 1**: `SELECT ... FROM orders WHERE number = $1 FOR UPDATE`; refuse on `updated_at` mismatch (`stale`), wrong status (`invalid_transition`), in flight refund (`refund_in_progress`), caps (`invalid_input` with field errors). Insert the `refunds` row (`pending`, `actor_type = admin`, the admin id, reason, `includes_shipping`), its `refund_lines` (quantity, `restock`), a `refund_created` event, and bump `orders.updated_at`. For a cancel, the same transaction also runs `markCancelled(from 'paid')` and writes its `status_changed` event.
2. Outside any transaction: `stripe.refunds.create({ payment_intent, amount, reason: "requested_by_customer", metadata: { refund_id, order_id, order_number } }, { idempotencyKey: refund_id })`. Errors are sorted into refused or unknown as in AC-12.
3. **Transaction 2** `applyRefundOutcome(tx, input)`: always takes the caller's transaction client, so the webhook shares it with its `stripe_events` insert (orders `AGENTS.md`). It applies the rules in *Refund outcomes*. When it changes nothing (the webhook got there first), the action reads the refund again and returns its current status. A cancel continues to step 4 either way.
4. Cancel only: when the outcome is `failed` because Stripe refused (not a later failure), `revertCancelled` moves the order from `cancelled` back to `paid` with its event, in transaction 2.
5. Cache expiry per entry point, after commit, for every product a restock touched. Server actions (`refundOrder`, `cancelOrder`, `checkRefundWithStripe`): `updateTag(catalogTag)` and `updateTag(productTag(slug))`, plus `revalidatePath` of the order page. Webhook and reconcile cron: `revalidateTag(tag, { expire: 0 })` through the existing `expireCatalogTags`.

### Refund outcomes (`applyRefundOutcome`, one function for reply, webhook and sync)

Match the row by `stripe_refund_id`, then by `metadata.refund_id`. Save `stripe_refund_id` when it is null. Map Stripe's status with `refundOutcome` (`succeeded` → succeeded; `failed`, `canceled` → failed; `pending`, `requires_action` → pending; anything else → pending plus `needs_attention` and a `refund.unknown_status` log, flagged once). Then apply:

| Stored | Stripe says | Effect |
|---|---|---|
| pending | pending | save the Stripe id only |
| pending | succeeded | status succeeded, `succeeded_at`, `refunded_cents += amount`, `refund_succeeded` event, `restockRefund` |
| pending | failed | status failed, `refund_failed` event with Stripe's message. If the refund had already been accepted by Stripe (its `stripe_refund_id` was set before this outcome), also `needs_attention` |
| succeeded | failed | status failed, `succeeded_at = null` (the existing CHECK needs it), `refunded_cents -= amount`, `refund_failed` event "Refund failed after succeeding; stock it returned was kept", `needs_attention` |
| failed | pending or succeeded | reopen to pending, or to succeeded with the succeeded effects above; `needs_attention`, `note` event "Stripe processed a refund the store had marked failed" |
| same as stored | | nothing (replay) |

Over the total: if adding `amount` would push `refunded_cents` above `total_cents` (a dashboard refund racing a pending admin refund), the refund is still recorded with its true status. `refunded_cents` is set to `total_cents`, `needs_attention` is set, and a `note` event records the overflow. The handler answers 200.

### Refund math (pure, `refund-math.ts`)

- `T` for a line is its `line_total_cents`. The order discount is already split into the lines, and `sum(line_total_cents) + shipping_cents = total_cents` (spec 0002 invariants), so refunding every unit plus delivery suggests exactly `total_cents`.
- Delivery: "Refund delivery" is offered while no refund that did not fail has `includes_shipping = true`. Ticking it adds `shipping_cents`. A goodwill refund never sets `includes_shipping`; `remaining` alone caps any overlap.

### Refund math (pure, `refund-math.ts`)

- `reserved = sum(amount_cents of refunds with status in (pending, succeeded))`; `remaining = total_cents - reserved`.
- Per line: `refundedUnits = sum(refund_lines.quantity of refunds not failed)`; `refundableUnits = quantity - refundedUnits`.
- Suggestion for refunding `q` more units of a line with total `T`, quantity `Q`, already refunded `r`: `floor(T * (r + q) / Q) - floor(T * r / Q)`. So refunding every unit, in any number of refunds, adds up to exactly `T`. "Refund delivery" adds `shipping_cents`. Suggestion = `min(sum, remaining)`.
- Amount cap: with lines or delivery chosen, `1 <= amount <= suggestion`; goodwill (nothing chosen), `1 <= amount <= remaining`.
- Restock cap per variant: `taken = -sum(delta of sale movements for this order and variant)`; `returned = sum(delta of return movements for this order and variant)`; `available = taken - returned`. Refund lines on that variant draw from `available` lowest order line first (by `order_lines.id`), each getting `min(quantity, what is left)`; 0 means no movement row and `restocked` stays false.

### API surface

All admin actions are server actions returning `{ ok: true, data } | { ok: false, error }`. Each takes `orderNumber` and `expectedUpdatedAt` (ISO string) besides the inputs listed, and each calls `requireAdmin()` first.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/admin/orders` | page | `q`, `status`, `attention`, `refund`, `from`, `to`, `before` (all optional) | filtered rows, `olderBefore` | admin `aal2` | bad params ignored |
| `/admin/orders/[number]` | page | `number` | detail, refunds, history, `allowedActions` | admin `aal2` | not found state |
| `markShipped` | action | `carrier?: string(≤100)`, `trackingNumber?: string(≤100)` | `{ status }` | admin | `stale`, `invalid_transition`, `refund_in_progress` |
| `markDelivered` | action | none | `{ status }` | admin | same |
| `undoStatus` | action | `reason: string(1..500)` | `{ status }` | admin | same, `invalid_input` |
| `editTracking` | action | `carrier?`, `trackingNumber?` | `{ ok }` | admin | `stale`, `invalid_transition`, `refund_in_progress`, `invalid_input` (nothing changed) |
| `refundOrder` | action | `lines: { orderLineId, quantity ≥1, restock: bool }[]`, `refundShipping: bool`, `amountCents: int`, `reason: string(1..500)` | `{ refundId, status: pending\|succeeded }` | admin | `stale`, `invalid_transition`, `refund_in_progress`, `invalid_input` (field errors), `stripe_refused` (message), `stripe_unavailable` |
| `cancelOrder` | action | `reason: string(1..500)`, `restockLineIds: string[]` (paid only; lines refunded are all refundable units, `restock` true on these ids) | `{ status: cancelled \| paid, refundId? }` | admin | `stale`, `invalid_transition`, `refund_in_progress`, `payment_in_progress` (pending order), `stripe_refused`, `stripe_unavailable` |
| `addNote` | action | `note: string(1..1000)` | `{ eventId }` | admin | `invalid_input` (no `stale` check, notes never conflict) |
| `resolveAttention` | action | `note: string(1..1000)` | `{ ok }` | admin | `stale`, `invalid_transition` (flag not set), `refund_in_progress` |
| `checkRefundWithStripe` | action | `refundId` | `{ status }` | admin | `stripe_unavailable`, `not_found` |
| `/api/stripe/webhook` (extend) | route POST | `refund.created`, `refund.updated`, `refund.failed` | 200 `{ received, result }` | Stripe signature | 400 bad signature, 500 processing error (Stripe retries) |
| `/api/cron/reconcile-orders` (extend) | route GET | Bearer `CRON_SECRET` | adds `refundsSynced`, `refundsFailed` counts | cron secret | 401 |

User facing messages (fixed strings): "This order changed. Reload to see the latest." (`stale`, `invalid_transition`) · "A refund is in progress for this order." · "A payment is in progress for this order. Wait for it to settle." · "Stripe refused the refund: <message>" · "Stripe did not answer. The refund is being checked." · "No orders match these filters."

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Any action | acting admin id, name | `requireAdmin()` |
| Any action | `expectedUpdatedAt` | the page render's `orders.updated_at`, posted back in the form |
| List | date bounds | `from`/`to` params validated as real calendar days, then turned into UTC instants at the start of `from` and the start of the day after `to` in `STORE_TIMEZONE` (env) by a DST safe helper in `src/lib/` (e.g. `zonedDayStart`) |
| List | refund state | `refunded_cents` vs `total_cents`: 0 → none, between → partial, equal → full |
| Mark shipped | `carrier`, `tracking_number` | admin form input (spec 0002) |
| Transitions | `shipped_at`, `delivered_at`, `cancelled_at` | DB `now()` |
| Refund | `amount_cents` | admin input, checked against *Refund math* computed from `order_lines`, `refunds`, `refund_lines`, `orders.shipping_cents`, `orders.total_cents` |
| Refund | `refund_lines.quantity`, `restock` | admin form input, capped by `refundableUnits` |
| Refund | `reason` | admin form input; Stripe receives the fixed `requested_by_customer` |
| Refund | `includes_shipping` | the "Refund delivery" checkbox; true on a cancel refund that covers unrefunded delivery |
| Refund | `amountCents` | the amount field in currency units × 100 (2 decimals, `STORE_CURRENCY`), rounded on the server |
| Event messages | ship, tracking, undo, cancel, resolve | as written in AC-4, AC-6, AC-7, AC-14, AC-20 (reason or note text) |
| Refund | Stripe `payment_intent` | `orders.stripe_payment_intent_id` (set by `markPaid`) |
| Refund | Stripe idempotency key | `refunds.id` |
| Refund | `stripe_refund_id`, outcome | Stripe reply, else the refund event's `data.object` |
| Refund | `succeeded_at` | the Stripe event's `created` on the webhook path, else `now()` (spec 0002) |
| Refund | `refunded_cents` | previous value + `amount_cents`, same transaction as `succeeded` |
| System refund (webhook) | order | `orders.stripe_payment_intent_id = refund.payment_intent` |
| System refund | `amount_cents`, `reason` | `refund.amount`, `refund.reason` (Stripe's enum text) |
| Restock | quantity | *Refund math* restock cap over `stock_movements` |
| Restock | movement `admin_id` | `refunds.admin_id` of the refund being restocked |
| Cancel paid | amount, lines | `remaining` and every line's `refundableUnits`; restock ticks from input |
| Cancel pending | session state | `stripe.checkout.sessions.retrieve` through `sessionState` |
| History | actor label | `order_events.actor_type` + `admin_users.name` |
| Order page | in flight refund | a `pending` refund with null `stripe_refund_id` and `created_at` within 10 minutes |
| Order page | "Check with Stripe" shown | a `pending` refund older than 2 minutes |

### Key invariants

- Only `src/lib/orders/transitions.ts` changes `orders.status`. Each transition is guarded by its from status.
- `orders.refunded_cents = min(total_cents, sum(amount_cents of succeeded refunds))` (the min only matters in the flagged over total case), written in the transaction that marks a refund succeeded. The existing CHECK keeps it `<= total_cents`.
- Reserved (pending plus succeeded) never exceeds `total_cents`; per line refunded units never exceed `quantity` (checked under the order row lock).
- A refund leaves `pending` exactly once. `applyRefundOutcome` updates only `WHERE status = 'pending'`, so the action, the webhook and the sync can race safely.
- No database transaction is open while Stripe is called.
- Stock comes back only from a succeeded refund, never more than the sale took, and always with a `return` movement in the same transaction (spec 0009). Variants are locked in id order, like `markPaid`.
- A `cancelled` order that took money has `refunded_cents = total_cents`, or a pending refund for the rest, or `needs_attention` set.
- Reasons and notes live only in `order_events.message` and `refunds.reason`, never in logs or Stripe metadata.

### Security model

- All admins are equal (spec 0004): any active admin at `aal2` may refund and cancel. The confirm step and the history (who, when, why) are the control. Every action calls `requireAdmin()` itself; the proxy is only the first gate.
- Money amounts come from the database. The client's `amountCents` is only accepted when it sits inside the server computed cap. The Stripe call uses the payment intent from the order row, never from input.
- Refund webhook events are trusted only after the signature check. The order comes from Stripe's `payment_intent` (or our `metadata.refund_id`), never from anything the browser sent.
- PII: order pages already show email, name, address and phone to admins. This feature adds free text notes and reasons that may hold PII, so they are never logged and never sent to Stripe.
- The search query is passed as a bound parameter with `%`, `_`, `\` escaped, never concatenated into SQL.

### Observability

pino events (order id, number, refund id, amounts, admin id; never PII, reasons, notes or tracking):
`order.shipped`, `order.delivered`, `order.status_reverted`, `order.tracking_updated`, `order.cancelled`, `order.attention_cleared`, `order.note_added`, `order.action_stale` (info), `refund.created`, `refund.succeeded`, `refund.failed` (warn), `refund.stripe_refused` (warn, with Stripe's error code), `refund.stripe_unavailable` (error), `refund.restocked`, `refund.restock_skipped` (warn, deleted variant), `refund.system_recorded`, `refund.late_failure` (error, pending then failed), `refund.unknown_status` (error), `cron.reconcile_refunds` (counts), `cron.reconcile_refund_failed` (error, one refund's failure, run continues). A failed query logs its SQLSTATE through `pgErrorCode`.

### Configuration required

- No new environment variables. The Stripe webhook endpoint (and the documented `stripe listen --events` list for local work) must add `refund.created`, `refund.updated`, `refund.failed`. When feature 19 deploys, the production endpoint subscribes to them too.
- `STRIPE_SECRET_KEY` already allows refunds. If a restricted key is ever used, it needs Refunds write.

### Critical test scenarios

- Happy path: paid order → Mark shipped with tracking → Mark delivered → history shows both with the admin's name, verifies **AC-4**, **AC-5**, **AC-21**
- Happy path: partial refund of 1 of 2 units with restock; Stripe answers succeeded; `refunded_cents` grows, stock +1 with a `return` movement, catalog tag expired, verifies **AC-9**, **AC-10**, **AC-13**
- Refund math: three single unit refunds of a 3 unit line totalling 1000 cents sum to exactly 1000; a shortfall line (sold 2 of 3) restocks at most 2, verifies **AC-11**, **AC-13**
- Concurrency: two `refundOrder` calls for the full remaining amount at once; exactly one reaches Stripe, the other gets `stale` and nothing reaches Stripe for it, verifies **AC-8**, **AC-11**
- Race: the webhook's `refund.updated succeeded` lands before transaction 2; the refund is counted once and restocked once, verifies **AC-16**
- Failure: Stripe API error on refund → refund failed, order unchanged, message shown; on cancel → order back to `paid` with a "Cancel undone" event, verifies **AC-12**, **AC-14**
- Failure: Stripe timeout → refund stays pending, actions refused as in flight, sync with no match leaves it pending until 24 hours, then marks it failed; a 5xx or rate limit error is treated the same as a timeout, verifies **AC-12**, **AC-17**, **AC-18**
- Late failure: succeeded refund then `refund.failed` → `refunded_cents` drops, `succeeded_at` null, flagged; a refund marked failed by the sync later reported succeeded → reopened and counted once, verifies **AC-17**
- Over total: a dashboard refund succeeds while an admin refund for the rest is pending → recorded, `refunded_cents` capped, flagged, webhook answers 200, verifies **AC-16**
- Cancel crash: the process dies after Stripe accepts the cancel refund → order is already `cancelled`, the sync settles the refund and restocks, verifies **AC-14**, **AC-17**
- Late failure: pending refund then `refund.failed` → failed, not counted, not restocked, order flagged, cancelled order stays cancelled, verifies **AC-17**
- Dashboard refund: `refund.created` without our metadata on a known payment → system refund recorded and counted once even if replayed; unknown payment → 200, nothing changes, verifies **AC-16**
- Undo: shipped → paid keeps tracking; delivered → shipped; undo without reason refused, verifies **AC-6**
- Cancel pending: open session expired then order cancelled and redemption deleted; paid session refused, verifies **AC-15**
- List: search by number, partial email, name; `50%` searched literally; status, attention, refund, date filters combined and paged; bad params ignored; `?view=all` works, verifies **AC-1**, **AC-2**, **AC-3**
- Auth/permission: a signed out visitor, an `aal1` session and a disabled admin calling `refundOrder` change nothing and get the spec 0004 answer, verifies **AC-22**
- Logs: a refund with a reason and a note produce log lines with no reason, note, email or name, verifies **AC-23**
- Accessibility: axe on the list (with filters) and the order page with the refund dialog open, keyboard only refund, verifies **AC-24**

## Build plan

Tracer Bullet: the first slice threads one status change through every layer (migration, transition, action, page, history, tests). Refunds then go end to end with Stripe before the webhook and sync thicken them. The list search and filters come last because they touch nothing else.

1. Write the two migrations (enum values; `refund_lines.restock`, `refunds.includes_shipping` and the `stock_movements` CHECKs) with the `schema.prisma` changes; db tests that a `return` row with a system actor or without an order is refused and extend `MovementRow` with `return`; db tests for the new CHECKs, satisfies **AC-13**
2. Thin thread: `allowedActions`, the `markShipped` transition, the Zod schema, the `markShipped` action with the `updated_at` stale check and `requireAdmin()`, the ship form on the order page, the history with actor labels; unit, db and e2e tests, satisfies **AC-4**, **AC-8**, **AC-21**, **AC-22**
3. `markDelivered`, `undoStatus` (both directions, reason dialog), `editTracking`; tests, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-8**
4. `addNote` and `resolveAttention` with the note form; tests, satisfies **AC-19**, **AC-20**
5. `refund-math.ts` with unit tests (suggestion sums, caps, restock cap), satisfies **AC-9**, **AC-11**, **AC-13**
6. Refund flow: `reserveRefund`, `requestStripeRefund`, `applyRefundOutcome`, `restockRefund`, the `refundOrder` action, refund form plus confirm step, refunds section and refund state badge, tag expiry; db tests with the Stripe client mocked at the edge (succeeded, pending, API error, timeout), satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-18**, **AC-21**
7. `cancelOrder`: paid (full remaining refund, restock ticked) and pending (session check through `sessionState`, redemption delete); `markCancelled` transition; tests, satisfies **AC-14**, **AC-15**
8. Webhook: refund event types in `event-decision.ts`, `refundOutcome` mapping, the full *Refund outcomes* table (including succeeded then failed, reopen, over total), the late payment flag in `markPaid`, dispatch in `stripe-events.ts` (our refund vs system refund), late failure flag; db tests with signed events, satisfies **AC-16**, **AC-17**
9. `syncPendingRefunds` in the reconcile cron plus the `checkRefundWithStripe` action and button; tests for each sync branch, satisfies **AC-17**
10. List: extend `parseAdminOrdersParams` and `getAdminOrders` (search, status, attention, refund state, date range, `view=all` alias), the filters form, the empty state; unit and db tests, satisfies **AC-1**, **AC-2**, **AC-3**
11. Logs for every action and webhook path, with a test that no PII field appears, satisfies **AC-23**
12. Accessibility and e2e: keyboard and axe on the list and order pages; e2e for ship, deliver, undo, note and filters always; e2e refund and cancel under `STRIPE_E2E=1` against a real test mode payment, satisfies **AC-24**, **AC-10**, **AC-14**

## Consequences

**Positive**:
- Admins never need the Stripe dashboard for a normal refund, and dashboard refunds still show up, so `refunded_cents` stays true for the sales dashboard (feature 15).
- A refund can never be counted twice or restock twice, however the action, webhook and sync interleave.
- Every change has an actor and a reason, which also covers the audit need for money changes.
- Feature 11 can hook the shipped and refunded emails onto the transitions and `applyRefundOutcome` without touching this logic.

**Negative / tradeoffs**:
- A refund that Stripe leaves `pending` blocks nothing, but a request that never got an answer blocks that order's actions for up to 10 minutes (or until "Check with Stripe").
- A dashboard refund whose webhook Stripe gave up on (after its retry window) is never picked up. The sync only follows refunds the store already knows about.
- Plain `ILIKE` search scans the orders table. Fine for thousands of orders, slow for hundreds of thousands.
- Goodwill refunds have no lines, so they never restock and do not reduce any line's refundable units.
- Admins are all equal, so any admin can refund any amount. The control is the history, not a permission.

**Neutral**:
- Two migrations instead of one, because of the Postgres enum rule.
- The orders `AGENTS.md` rule "every write that changes an order must be guarded by `status = 'pending_payment'`" becomes "guarded by the status it moves from" (for `/sync`).
- `/admin/orders?view=all` becomes `status=all`, with the old link kept as an alias.

## Follow-up

- [ ] Feature 11 (Order emails): send `order_shipped` from the shipped transition and `order_refunded` from a succeeded refund; an undo never unsends.
- [ ] Add `pg_trgm` indexes on the searched columns if the list is measured as slow.
- [ ] Feature 19 (Production deploy): subscribe the production webhook endpoint to the three `refund.*` events.
- [ ] Spec 0002's open question "Feature 10 decides whether cancelling a paid order requires a refund and whether it restocks" is answered here: cancel refunds the rest, restock is per line and ticked by default (for `/sync` to mark).
