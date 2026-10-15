# 0012. Customer accounts

**Date**: 2026-10-14 (amended the same day after a cross check: AC-1 to AC-5, AC-7 to AC-11, AC-13 to AC-15, AC-17, AC-19, AC-20, AC-23, AC-24, AC-26; amended 2026-10-14 again: AC-15 now names where the order's `customer_name` comes from; amended 2026-10-15 after the code review: AC-2, AC-3, AC-5, AC-7, AC-13, AC-24, the template choice, and the leftover account cart cookie)
**Status**: In Progress

## Summary

Customers can make an optional account. They give their email, click the link we send, and then choose a password. Guest checkout stays the default. The account shows past orders (including earlier guest orders with the same email). It keeps an address book that fills in checkout, and lets customers change their profile and password or delete the account. It runs on the Supabase Auth the admin panel already uses, sharing one user pool with admins. Supabase hands every auth email (confirm sign up, reset password) to a small route of ours, which sends it through Resend with React Email, so customer and admin emails each get their own words.

## Requirements

**User stories**:
- As a shopper, I want to keep buying as a guest, so that an account is never in my way.
- As a returning customer, I want to sign in and see every order I placed with my email, so that I can check what I bought and where it is.
- As a returning customer, I want checkout to fill in my saved address, so that I can pay faster.
- As a customer who forgot my password, I want a reset link by email, so that I can get back in.
- As a customer, I want to delete my account, so that the store stops keeping my profile and addresses.
- As an admin, I want to see whether an order belongs to an account, so that I know whether the customer can look it up themselves.

**Acceptance criteria**:

*Sign up and confirm*
- **AC-1**: `/account/sign-up` asks for an email only. On submit the page always shows the same "Check your email" screen, with a "Send the link again" button. This holds for a new email, an existing confirmed or unconfirmed account, and an admin's email. The Supabase `signUp` call (and the resend) run in `after()`, so neither the reply nor its timing reveals whether an account exists, and no Supabase error (rate limit, send failure) ever reaches the screen; failures are only logged. `signUp` is given a random throwaway password: 32 random bytes in base64url, plus a suffix that meets the character classes. It is never shown, stored or logged. The customer chooses the real password after confirming (AC-3), so a password set by whoever signed up first never survives a confirm. Emails are stored in lower case.
- **AC-2**: The confirm email (AC-8) links to `/account/confirm?token_hash=<hash>&type=signup`. Opening the link changes nothing. The page accepts only `type` `signup` or `recovery` (any other value, or a missing hash, shows the invalid link message). It shows a "Continue" button whose form carries the hash and type as hidden inputs, and only that POST (`confirmEmail`) spends the token with `verifyOtp`. This is the scanner safe pattern of spec 0004 AC-9. The page sends `Referrer-Policy: no-referrer`. On success the visitor is signed in and goes to `/account/set-password`. For `signup` and a user who does not run the store (the AC-8 admin check), `confirmEmail` first replaces the password with a new throwaway one (AC-1) and signs out every other session (`scope: 'others'`), so a password planted before the confirm never works, even when the customer leaves set password without choosing one. A failure there is logged and the customer goes on to set password, which replaces it anyway. For `recovery`, a user who runs the store (the AC-8 admin check) goes to `/admin/mfa?next=/admin/reset-password` instead, as `/auth/confirm` does, so an admin link pasted here still needs the authenticator. An expired, used or bad link shows "This link has expired or was already used." with the AC-1 resend form (for `signup`) or a link to forgot password (for `recovery`).
- **AC-3**: `/account/set-password` needs a session (from AC-2 or AC-9) and asks for a new password. The rule is spec 0004 AC-10's project wide Supabase policy: 8 or more characters with lower case, upper case, digits and symbols, and at most 72 bytes. The shared Zod schema checks it and names each missing part. Supabase's `weak_password` answer for a leaked password shows "This password has appeared in a data leak. Choose another." and `same_password` shows "Choose a password you have not used here before." On success: `updateUser({ password })`, every other session of the user is signed out (`scope: 'others'`), AC-10 runs, and the customer lands on `/account` with "Your account is ready." (after sign up) or "Your password is changed." (after reset). A user who runs the store (the AC-8 admin check) is refused with the AC-19 message, `runs_the_store`; their password changes only on `/admin` behind the authenticator. A visitor who leaves without choosing stays signed in. Their account works, and they can set a password later through forgot password.

*Sign in and sign out*
- **AC-4**: `/account/sign-in` takes email and password. A wrong password, an unknown email and an unconfirmed account all show "That email and password do not match." Supabase's per IP limit shows "Too many attempts. Wait a minute and try again." On success AC-10 runs, then the customer goes to `next` when it is safe, else to `/account`. Safe means: decoded, starts with exactly one `/`, contains no `\`, no `//` and no scheme, and is exactly `/checkout` or a path under `/account` that is not an auth page (AC-13). A visitor who already has any session (a customer, or an admin who signed in at `/admin`) and opens the sign in or sign up page goes to `/account`, so a customer sign in never replaces a live admin session.
- **AC-5**: Cart merge (`src/lib/cart/merge.ts`), used by sign in, `addToCart` and `startCheckout`. It runs in one transaction that first takes the customer lock (`pg_advisory_xact_lock` keyed on the customer id; the same lock serializes AC-10, AC-14 and the AC-15 save), then locks the carts involved (`SELECT ... FOR UPDATE`).
  * If the cookie names a guest cart and the customer has no cart, the guest cart gets the customer's id.
  * If both exist, each guest line is added to the account cart. Quantities of the same variant are summed and capped by `lineCap`, which is the variant's stock or 10, read under the lock. A guest line for an archived or sold out variant moves as it is when the account cart has no line for that variant, and its flags are computed at read time as today. When the account cart already has that variant, the account line stays as it is and the guest quantity is dropped: one line per variant, and nothing there can be bought. The guest cart is then deleted.
  * The cookie ends on the account cart, or on the guest cart when that one became the account cart. With no guest cart, the cookie is set to the account cart if there is one.
  * A cookie naming another customer's cart is ignored and replaced.
  * Every merge renews the cookie and `expires_at` (30 days).
  * A pending order on a deleted guest cart keeps its row with `cart_id` null, as when the expired cart cron deletes a cart.
- **AC-6**: "Sign out" (in the account area) signs out this browser only (`scope: 'local'`), clears the cart cookie, and goes to the home page with `RedirectType.replace`. The account cart stays in the database for the next sign in. Admins and customers share one session per browser, so this also ends an admin session in the same browser.
- **AC-7**: When `addToCart` must create a new cart (no valid cookie cart), it calls `getCustomerId()` (AC-10). With a customer, it takes the customer lock and uses their existing cart if there is one, setting the cookie to it. Otherwise it creates the cart with `customer_id` set. A visitor with no valid session gets a guest cart exactly as today.
  * A cookie cart with a `customer_id` belongs to that customer only. This covers a session that ended without our sign out (expiry, sign out on another device, an admin sign out in the same browser).
    - One helper in `src/lib/cart/` (`readOwnedCartId()`, plus an owned variant of `loadCart`) reads the cookie cart with its `customer_id`. When that is set it calls `getCustomerId()`, and returns no cart unless the same customer is signed in. A `getUser()` failure counts as no cart, never a 500.
    - Its callers: `addToCart`, `setCartItemQuantity`, `removeCartItem`, `startCheckout`, `checkoutPrefill`, the `/cart` page and the checkout summary. They run at request time inside their existing Suspense boundaries, never in a `'use cache'` function.
    - No cart means: `addToCart` takes its create branch (a guest cart, or the signed in customer's own account cart), so a signed in customer whose cookie names another customer's cart adds to their own; `setCartItemQuantity` and `removeCartItem` answer `not_found`; `startCheckout` gives its empty cart answer; the pages render their empty state.
    - Only a successful add replaces the cookie. Read paths and the `not_found` answers never clear or renew it.
    - `hasLiveCart` in `addToCart` becomes "live and owned": it also selects `customer_id`, so a live foreign cart no longer skips the session read.
    - The header cart count keeps the raw read, so catalog pages never call Supabase (AC-22). It is the one exception and shows only a number.
  * No other cart path reads the session.

*Auth emails and password reset*
- **AC-8**: Send Email Hook. `supabase/config.toml` sets `[auth.hook.send_email]` with `enabled = true`, `uri = "env(SEND_EMAIL_HOOK_URI)"` and `secrets = "env(SEND_EMAIL_HOOK_SECRET)"`. Supabase then calls `POST /api/auth/send-email` for every auth email.
  * The route verifies the Standard Webhooks signature over the raw body (`await request.text()`, parsed only after). The `standardwebhooks` package gets the secret with its `v1,whsec_` prefix stripped. A bad or stale signature answers 401 and sends nothing.
  * It picks the template from the payload. `signup` sends "Confirm your email" (customer), linking to `/account/confirm?token_hash=<hash>&type=signup`. `recovery` sends the admin reset email when the user has an `admin_users` row (any state) or a verified TOTP factor, read only from `auth.mfa_factors` with `$queryRaw` as spec 0004 does. That email keeps spec 0004's wording, now as a React Email template, and links to `/auth/confirm?token_hash=<hash>&type=recovery`. It is sent whatever `redirect_to` says, so an inbox alone never resets a password that guards `/admin`. Any other `recovery` sends "Reset your password" (customer), linking to `/account/confirm?token_hash=<hash>&type=recovery`.
  * Any other action type (`magiclink`, `invite`, `email_change`, `reauthentication`) is never used by this store. It answers 400, sends nothing and logs `auth_email.unexpected_type`.
  * Each email has the brand wordmark and a plain text version, has no tracking, and goes through the current transport with the idempotency key `auth:<email_action_type>:<sha256 of token_hash>`. There is one try with a 4 second timeout, to fit Supabase's 5 second hook limit.
  * A failure answers 500 with `{ "error": { "http_code": 500, "message": "send failed" } }`. Supabase then fails its request with `hook_failed` or `hook_timeout`. Because sign up, resend and forgot password run in `after()`, that only shows in the logs (`auth_email.failed`).
  * `supabase/templates/recovery.html` and its `config.toml` entry are removed. Spec 0004's admin reset e2e passes unchanged through the new route.
  * The hook serves local, CI and production only. Supabase allows one hook URL per project, and preview deploys sit behind Deployment Protection.
- **AC-9**: Forgot password. `/account/forgot-password` shows "If there is an account for that email, a reset link is on its way." for any email. The `resetPasswordForEmail` call, with `redirectTo` set to `${NEXT_PUBLIC_SITE_URL}/account/set-password`, runs in `after()`, so the reply and its timing are the same either way. After Continue on the recovery link (AC-2), the customer sets a new password on `/account/set-password` (AC-3). For an admin or a user with an authenticator, AC-8 sends the admin email instead, and the reset happens on `/admin` with the code.

*Account linking*
- **AC-10**: Account session and setup.
  * `getCustomerId()` (in `src/lib/customer/session.ts`) reads the user with `getUser()`, which Supabase checks on its server. It never uses `getClaims()`, which trusts a token for up to an hour after the account is deleted. When the user is valid and confirmed, it upserts the `customers` row (id, lower cased email) under the customer lock and returns the id. Otherwise it returns null.
  * `requireCustomer()` wraps `getCustomerId()` and answers the signed out case.
  * "Account setup" runs after AC-3 and every sign in, in one transaction under the customer lock: (1) upsert the `customers` row; (2) link guest orders with `UPDATE orders SET customer_id = <id> WHERE email = <email> AND customer_id IS NULL` (checkout already stores `orders.email` in lower case, so an equality match is enough; linked `pending_payment` orders stay hidden until paid); (3) the AC-5 merge. The id and email come from the `data.user` that `verifyOtp`, `signInWithPassword` or `updateUser` returned, not from a cookie read in the same request.
  * If another `customers` row already holds the email, it is deleted first only when no `auth.users` row exists for its id (read only with `$queryRaw`). Otherwise setup stops, logs `account.email_conflict` (error), and the page shows "Something went wrong. Try again later."

*Account area*
- **AC-11**: `/account` lists the customer's orders that have `paid_at` set and status `paid`, `shipped`, `delivered` or `cancelled`. Newest `paid_at` comes first (ties by id), 20 per page with Previous and Next (`?page=N`). Each row shows the order number, the paid date (`formatDate`, `STORE_TIMEZONE`), the status in words (Paid, Shipped, Delivered, Cancelled), the item count and the total (`formatMoney`). With none it shows "No orders yet." and a link to the shop. Unpaid orders (`pending_payment`, `expired`, cancelled before payment) never show.
- **AC-12**: `/account/orders/[number]` shows one order: number, paid date, status, and every line from the order's snapshot (product name, variant label, quantity, unit price, line total). Then the subtotal, the discount when above 0, the delivery fee ("Free" when 0), the total, "Refunded <amount>" when `refunded_cents` is above 0, the delivery address (left out when the order has none), and carrier and tracking number when set. Orders shown here are never PII purged (spec 0008 purges only expired orders).
- **AC-13**: The auth pages are `/account/sign-in`, `/account/sign-up`, `/account/forgot-password` and `/account/confirm`, and they are public. Every other page and action under `/account` calls `requireCustomer()` itself, `/account/set-password` included. Its action `setPassword` is the one exception: it reads the user with `getUser()` directly (any valid session), because it runs AC-10 itself from the user `updateUser` returns. The proxy decides before rendering: it sends a signed out visitor from a non auth account page to `/account/sign-in?next=<path>`. As in spec 0004, it skips redirects for server action requests (`Next-Action` header) and sets `Cache-Control: no-store` on account pages and their redirects. An order number that does not exist, belongs to another customer or to no one, or has a hidden status (AC-11) renders the same not found content, with no hint which.

*Address book*
- **AC-14**: `/account/addresses` lists the saved addresses (default first, then newest by `created_at`, then id) with Add, Edit, Delete and "Make default".
  * Fields and rules are `shippingAddressSchema` from spec 0007. The country is the store's one country and cannot be edited.
  * At most 10 addresses. At 10, Add is replaced by "You can save up to 10 addresses." and the action refuses an 11th.
  * The first address saved becomes the default. Deleting the default makes the newest remaining address the default.
  * Every write runs under the customer lock. A change of default clears the old one before setting the new one, so the partial unique index never fails.
  * A saved address that no longer passes the current `shippingAddressSchema` shows "Check this address" and must be edited before checkout uses it.

*Checkout*
- **AC-15**: Signed in checkout (`getCustomerId()` returns an id).
  * The email shows read only as the account email. `startCheckout` still validates the typed email field but uses `customers.email`.
  * The address form starts with the pending order's address for this cart when there is one (spec 0007 prefill), else with the default address. A list of saved addresses lets the customer swap, and they can still type a new one.
  * "Save this address to my account" is ticked by default. When ticked, the save runs in the order's transaction under the customer lock. Fields are trimmed and an empty `line2` or `phone` counts as null. An address equal to a saved one, field by field, adds nothing. Otherwise a new row is added, and it is the default if it is the first. At 10 saved, the save is skipped without a message.
  * The order's `customer_name` is `customers.name` when that is set, else the delivery full name (`ship_full_name`). A guest order (signed out) always gets the delivery full name. Before this, nothing set `customer_name`, so order emails said "Hello," and admin search on it never matched.
  * "Set" and "blank" mean exactly: blank is null or `""` (the profile schema already stores names trimmed or null), the same test the phone fill uses. No new validation: `fullName` and the profile name are both trimmed and capped at 100. `customer_name` is written only when the order is created (checkout never reuses a pending order; spec 0008's purge already nulls it on expired orders).
  * A blank `customers.name` is then filled from the order's `customer_name`, and a blank `phone` from its `phone`, whether or not the save box is ticked. Values already set are never overwritten. The fill is silent: no new log event, and `customer_name` never appears in a log (AC-24).
  * The order gets `customer_id`.
  * Before the order is created, a guest cookie cart goes through the AC-5 merge. If the merge added lines from the account cart, `startCheckout` returns `cart_changed`. The form then reloads with "Your cart was updated with items saved in your account. Check it and pay again."
- **AC-16**: A signed out visitor on `/checkout` sees "Have an account? Sign in", linking to `/account/sign-in?next=/checkout`. After sign in they are back on `/checkout` with the merged cart and their default address filled in.
- **AC-17**: `/checkout/complete` offers "Create an account to track this order" (a button, no fields) only when all of these hold:
  * the order named by the session id exists, has status `paid`, `shipped` or `delivered`, has no `customer_id`, and has a non null email;
  * the visitor has no session.

  `signUpFromOrder` checks the same conditions on the server and otherwise returns `not_eligible`. It reads the email from the order, never from the browser, and runs the AC-1 sign up. The page shows "Check your email." If an account already exists for that email, nothing is sent, and the order links at that customer's next sign in (AC-10).

*Profile and security*
- **AC-18**: `/account/settings` edits name and phone (both optional, the same field rules as checkout) and shows the email read only with the note "To change your email, contact us."
- **AC-19**: Change password asks for the current password and a new one under the AC-3 rule. A user with an `admin_users` row or a verified factor is refused: "This account also runs the store. Use Forgot password on the admin sign in page." A wrong current password shows "Your current password is not right." On success every other session of the user is signed out and this one stays.
- **AC-20**: "Delete my account" asks for the password.
  * If the customer has orders with status `paid`, the dialog first says "You have <n> order(s) not shipped yet. They will still be delivered, and emails about them still go to <email>."
  * A user with an `admin_users` row (any state) is refused: "This account also runs the store, so it cannot be deleted here."
  * Otherwise, in one transaction under the customer lock: the `customers` row is deleted (its addresses and cart cascade, and its orders keep their snapshot with `customer_id` null, spec 0002 AC-7). Then `auth.admin.deleteUser(id)` runs through the service role client, then the transaction commits. If the API call fails, the transaction rolls back and the form shows "We could not delete your account. Try again." In the rare case where the commit fails after the API call, `account.delete_incomplete` is logged (error). The leftover row has no login, and AC-10 removes it if the email signs up again.
  * The auth and cart cookies are cleared, and the visitor lands on the home page with "Your account is deleted."

*Admin*
- **AC-21**: The admin order list and order detail select `customer_id` and show "Account" when it is set and "Guest" when it is null. No other admin change.

*Platform, logs, accessibility*
- **AC-22**: The store header has a plain "Account" link to `/account`, the same for everyone. Catalog pages stay cached and never call Supabase. The proxy matcher becomes `/admin/:path*`, `/auth/:path*`, `/account/:path*`, `/checkout/:path*`. On `/account` and `/checkout` the proxy refreshes the session, and the admin check stays independent of it.
- **AC-23**: `EMAIL_TRANSPORT` gains `mailpit`, which posts every email to Mailpit's send API at `MAILPIT_URL` (with no idempotency; every call lands). The env schema refuses `mailpit` when `VERCEL_ENV` is `production` and requires `MAILPIT_URL` with it. Playwright and CI use `mailpit` (Vitest stays on `log`), so e2e reads the confirm and reset emails from Mailpit as the admin reset test does today. `supabase/config.toml` changes:
  * public sign up on (`[auth] enable_signup = true`);
  * `[auth.email] enable_confirmations = true` kept;
  * `${site}/account/**` added to `additional_redirect_urls`;
  * the AC-8 hook block;
  * spec 0004's raised local rate limits kept, plus `[auth.email] max_frequency = "1s"`, so e2e can resend at once.

  Production keeps Supabase's default limits and link expiry (AC-26).
- **AC-24**: Logs carry the customer id, order ids and numbers, counts and error codes. They never carry an email, name, phone, address, password, token, token hash or idempotency key. Events:
  * `account.sign_up`, `account.sign_in`, `account.sign_in_failed` (reason code), `account.confirmed`, `account.orders_linked` (count), `account.cart_merged` (guest lines that went into the account cart, moved or summed, not dropped; an adopted guest cart counts all its lines; no event when there was no guest cart), `account.reset_requested` (sent flag, reason code);
  * `account.address_saved`, `account.password_changed`, `account.password_reset`, `account.deleted`, `account.delete_refused_admin`;
  * `account.email_conflict` (error), `account.delete_incomplete` (error);
  * `auth_email.sent` (kind), `auth_email.failed` (kind, error name, error level, so it can alert), `auth_email.bad_signature` (warn), `auth_email.unexpected_type` (warn).
- **AC-25**: Every account page, form and dialog works by keyboard alone, labels every field, announces errors, moves focus to the first invalid field, and passes axe with zero violations on desktop and phone (same tags as spec 0003). Every account page has static `robots: noindex` metadata and reads the session only inside Suspense.
- **AC-26**: Sign in, sign up, resend and reset rely on Supabase's built in limits. The production runbook adds a Vercel Firewall rate limit rule for `POST` to `/account/*` and `/checkout/complete`. It also lists the production Supabase settings: sign up on, confirmations on, `/account/**` in the redirect URLs, and the hook URL and secret. These are applied at deploy (scope feature 19).

## Decision

**Chosen option**: Option 1: Supabase Auth email and password accounts in the user pool admins already use, with every auth email sent by our own Send Email Hook route through Resend and React Email.

Customers get accounts with no new auth vendor, and the shared reset template problem from spec 0004 is solved by choosing the email in our code instead of in a Supabase template.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `prisma-client-api` (`prisma/skills`, `.agents/skills/prisma-client-api/`) · `react-email` (`resend/resend-skills`, `.agents/skills/react-email/`) · `resend` (`resend/resend-skills`, `.agents/skills/resend/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`)

**Decisions made in design (recommended picks, with runner up)**:
- **Code layout.** A new `src/features/account/` holds the account pages' components, actions, queries, schemas and logs. Pieces another feature also calls go to `src/lib/`:
  * `src/lib/customer/session.ts`: `getCustomerId()` and `requireCustomer()`;
  * `src/lib/customer/lock.ts`: the advisory lock helper;
  * `src/lib/customer/setup.ts`: AC-10's upsert and order linking;
  * `src/lib/customer/addresses.ts`: the save with dedupe and cap, used by checkout and the address book;
  * `src/lib/cart/merge.ts`: AC-5.

  Auth email code lives in `src/lib/email/auth-hook.ts` (payload schema, template choice, link building) beside the existing transport. The templates are `emails/confirm-signup.tsx`, `emails/reset-password.tsx` and `emails/admin-reset-password.tsx`. Routes: `app/(store)/account/...` and `app/api/auth/send-email/route.ts`. The service role client stays in the existing `src/lib/supabase/admin.ts` (`server-only`). Runner up: session and linking inside `src/features/account/`, which checkout could then not import.
- **Password chosen after the confirm link**, not at sign up. GoTrue overwrites the password when someone signs up again with an unconfirmed email. So anyone, through our form or straight against the public API, could plant a password on someone else's email before that person confirms. When the inbox owner chooses the password after confirming, any planted one is gone. Runner up: password at sign up, which keeps one screen but leaves that hole.
- **`getUser()` for every account check**, a call to Supabase's server per account request. Runner up: `getClaims()` (local and fast), which keeps a deleted user working for up to an hour and would recreate their row.
- **One advisory lock per customer** (`pg_advisory_xact_lock(hashtext('customer:' || id))`) instead of row locks across `customers`, `carts` and `customer_addresses`. "No cart yet" or "no address yet" have no row to lock, and one mutex makes the lock order question go away. Runner up: lock the `customers` row first, which needs the row to exist before every path.
- **Signature check with the `standardwebhooks` package**, the reference implementation Supabase documents for its hooks, including the timestamp tolerance. Runner up: a hand written HMAC check, about 20 lines but one more thing to get subtly wrong.
- **Auth emails are not written to `email_sends`.** The hook is synchronous with one try, and the customer can press "Send the link again". The outbox in spec 0011 exists for emails owed after a commit, which these are not. Runner up: an outbox row per auth email, which would add a table kind with no retry to drive.
- **Template choice: the email type, then the admin check; `redirect_to` is not read.** Anyone with the public anon key can call Supabase's recover endpoint with any allowed `redirect_to`, so it is a hint, not a trust boundary. The admin check (an `admin_users` row or a TOTP factor) cannot be steered, and every other `recovery` is a customer reset, so `redirect_to` would add nothing (amended 2026-10-15; the first draft also parsed it). Runner up: `redirect_to` alone, which would let an inbox owner reset an admin password with no code.
- **Password checks for change and delete** call `signInWithPassword` on the stateless client (`createSupabaseStatelessClient`, no cookies) with the session's email. The throwaway session it returns is then signed out with its own access token (a failure there is logged, not shown). Guessing is limited by Supabase's per IP sign in limits and the Firewall rule. Runner up: Supabase `reauthenticate`, which sends a code by email instead of asking for the password the customer just typed.
- **Delete: database rows and auth user in one transaction**, the API call made before commit, so a failed API call rolls back and leaves nothing half done. Runner up: auth first and then the rows, which can strand PII for good when the second step fails.
- **Not found for orders renders inside the page** (`notFound()`), which answers 200 under Cache Components. The page is private and `noindex`, so the status does not matter, and only the signed out redirect is decided in the proxy. Runner up: an ownership check in the proxy, which would put a DB query on every account request.
- **Order `customer_name`: the profile name, else the delivery full name.** It is the buyer's name as best we know it before payment, with no new checkout field. A signed in customer who set a name is greeted by it even when shipping to someone else; everyone else is greeted by the recipient's name. The blank profile fill then copies it, so it stays a one time fill that never overwrites. Existing orders are not backfilled (nothing is deployed, only local and test data). Runners up: always the delivery full name (simpler, but ignores a name the customer chose); the Stripe billing name from the webhook (`customer_details.name`, the true payer, but only after payment, it couples the profile fill to the webhook, and the cardholder may be someone else); or dropping `customer_name` and leaving the profile name to settings only.
- **No order events for linking.** Linking only changes who can view an order, and `account.orders_linked` records it. Runner up: a `note` event per linked order, which would flood the admin timeline for a frequent guest.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (no migration; every table below exists since spec 0002):

| Table | Key | Relationships | Used for |
|---|---|---|---|
| `customers` | `id` uuid = Supabase auth user id (no FK into `auth`) | 1:N `customer_addresses` (Cascade), 1:1 `carts` (Cascade), 1:N `orders` (SetNull) | Created or refreshed by AC-10. `email` text unique, lower case, equal to the auth email. `name`, `phone` nullable. |
| `customer_addresses` | `id` uuid v7 | N:1 `customers` | Address book (AC-14, AC-15). `full_name`, `line1`, `line2?`, `city`, `postal_code`, `country_code` char(2), `phone?`, `is_default`. Partial unique index: one default per customer. |
| `carts` | `id` uuid v7 | `customer_id` unique nullable → `customers` | The account cart (AC-5, AC-7, AC-15). |
| `orders` | `id` uuid v7 | `customer_id` nullable → `customers` SetNull | Linked by AC-10, listed by AC-11, shown by AC-12. Existing indexes on `email` and `customer_id` serve linking and history; `email` is already lower case from checkout. |
| `admin_users` | `id` = auth user id | none to `customers` | Read by AC-8, AC-19 and AC-20. |
| `auth.users`, `auth.mfa_factors` (Supabase) | `id` | none (spec 0001) | Password, confirmation, sessions; read only through `$queryRaw` in AC-8 and AC-10. |

**State transitions** (an account, as seen by this feature):

`no account` → sign up → `unconfirmed` (auth user with a throwaway password, no `customers` row, cannot sign in) → Continue on the confirm link → `confirmed` (signed in, password still unknown to the customer) → choose password → `active` (`customers` row, orders linked). A `confirmed` customer who leaves before choosing can still use the session, and later reaches `active` through forgot password. `active` → Delete → `deleted` (auth user and rows gone, orders unlinked). Sessions: `signed out` ⇄ `signed in`. Choosing or changing a password ends the other sessions.

**API surface** (server actions unless a method is given; all return `{ ok: true, data } | { ok: false, error }`):

| Action / route | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `signUp` | action | `email` (req) | `check_email` (always) | public | `invalid` (email format only) |
| `resendConfirmation` | action | `email` (req) | `check_email` (always) | public | `invalid` |
| `confirmEmail` | action (POST from `/account/confirm`) | `tokenHash`, `type` `signup` or `recovery` (hidden inputs, req) | redirect `/account/set-password` | public, token | `link_invalid` |
| `setPassword` | action | `password` (req) | redirect `/account` | any session | `weak_password`, `leaked_password`, `same_password`, `session_missing`, `runs_the_store`, `setup_failed` |
| `signInCustomer` | action | `email`, `password` (req), `next` (opt) | redirect to safe `next` or `/account` | public | `invalid_credentials`, `rate_limited`, `setup_failed` |
| `signOutCustomer` | action | none | redirect `/` | signed in | none |
| `requestPasswordReset` | action | `email` (req) | `sent` (always) | public | `invalid` |
| `updateProfile` | action | `name?`, `phone?` | profile | customer | `invalid` |
| `changePassword` | action | `currentPassword`, `newPassword` (req) | `changed` | customer | `wrong_password`, `weak_password`, `leaked_password`, `same_password`, `runs_the_store` |
| `deleteAccount` | action | `password` (req) | redirect `/` | customer | `wrong_password`, `runs_the_store`, `delete_failed` |
| `createAddress`, `updateAddress` | action | address fields (req), `id` (update) | address | customer | `invalid`, `limit_reached`, `not_found` |
| `deleteAddress`, `setDefaultAddress` | action | `id` (req) | addresses | customer | `not_found` |
| `signUpFromOrder` | action | `sessionId` (req) | `check_email` | public, session id | `not_eligible` |
| `startCheckout` (changed) | action | as today, plus `saveAddress: boolean` | as today | public or customer | as today, plus `cart_changed` |
| `addToCart` (changed) | action | as today | as today | public or customer | as today |
| `/api/auth/send-email` | POST | Standard Webhooks headers, raw body `{ user, email_data }` | `{}` 200 | signature | 401 bad signature, 400 unused type, 500 send failed |
| Pages | GET | auth pages (public): `/account/sign-in`, `/account/sign-up`, `/account/forgot-password`, `/account/confirm`; account pages (session): `/account`, `/account/orders/[number]`, `/account/addresses`, `/account/settings`, `/account/set-password` | | see AC-13 | proxy redirect when signed out |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `signUp` | throwaway password | 32 bytes from `crypto.randomBytes`, base64url, plus a fixed class suffix (AC-1) |
| hook | confirm or reset link | `NEXT_PUBLIC_SITE_URL` + path chosen by AC-8 + `email_data.token_hash` + type |
| hook | recipient | `user.email` in the signed payload |
| hook | which template | `email_action_type`, then `admin_users` by `user.id` and verified rows in `auth.mfa_factors`; `redirect_to` is not read |
| hook | brand name, sender | `src/lib/brand`, `EMAIL_FROM` (spec 0011) |
| hook | idempotency key | `auth:` + `email_action_type` + `:` + SHA 256 of `token_hash` |
| `setPassword`, `signInCustomer` | customer id and email for AC-10 | `data.user` returned by `updateUser` or `signInWithPassword` |
| account pages and writes | customer id | `getCustomerId()` (`getUser()`) |
| `signInCustomer` | redirect target | `next` input, accepted only per AC-4 |
| cart actions, `/cart`, `/checkout` | owner of the cookie cart | `carts.customer_id` read by `readOwnedCartId()`; when set, `getCustomerId()` must return that customer (AC-7) |
| AC-5 merge | `account.cart_merged` lines | guest lines moved or summed into the account cart, or every line of an adopted guest cart |
| AC-5 merge | line cap | `lineCap(variant.stock_quantity)` in `src/lib/availability.ts`, read under the lock |
| `/account` | paid date, total, item count, status words, page | `orders.paid_at`, `total_cents` and `currency`, sum of `order_lines.quantity`, `status` mapped in AC-11, `page` search param |
| `/account/orders/[number]` | lines, totals, address, tracking, refunded | order snapshot columns, `order_lines`, `refunded_cents`, `carrier`, `tracking_number` |
| dates | timezone and locale | `STORE_TIMEZONE`, `STORE_LOCALE` (existing env) |
| `startCheckout` signed in | email, customer id | `customers.email` of `getCustomerId()` |
| `startCheckout` | order `customer_name` | signed in: `customers.name` of `getCustomerId()`, read with `tx.customer.findUnique` right after `lockCustomer` in the order's transaction, when not null or `""`; otherwise (blank profile, a missing customers row, or a guest) the parsed `fullName` that also becomes `ship_full_name`. Set as its own field on the order create, not inside `deliveryColumns` |
| `startCheckout` | save address flag; profile fill | `saveAddress` input; the order's `customer_name` (fills a blank `customers.name` through `updateMany` where name is null or `""`) and `phone` (fills a blank `customers.phone`) |
| checkout page | prefill | pending order for this cart (spec 0007), else default `customer_addresses` row |
| address book | country | the store's country from `src/lib/shipping` (spec 0007) |
| `signUpFromOrder` | email, eligibility | the order found by `stripe_checkout_session_id`: `email`, `status`, `customer_id`; the visitor's session |
| AC-20 | open order count, admin refusal | count of the customer's `orders` with status `paid`; `admin_users` row by id |
| AC-21 | Account or Guest | `orders.customer_id` null or not |

**Key invariants**:
- `customers.id` always equals a live or just deleted Supabase auth user id, and `customers.email` the lower cased auth email.
- A customer reads and writes only rows with their own `customer_id`; the id always comes from `getUser()` or a Supabase answer, never from input.
- An order joins an account only through AC-10 linking (verified email on an unlinked order) or a signed in checkout. Nothing ever moves an order from one customer to another.
- A cart with a `customer_id` is read or written only by that customer's session (AC-7). The header's item count is the one exception.
- At most one default address and at most 10 addresses per customer. At most one cart per customer, and a merge never pushes a line above `lineCap`.
- Every write that touches one customer's cart, addresses or order links holds that customer's advisory lock.
- Account history never shows an order without `paid_at`.
- Prices and totals on account pages come from the order snapshot, never the live catalog.
- Only someone with the inbox chooses an account's password, and a password that guards `/admin` is never reset without the authenticator.
- No auth email leaves without a valid hook signature, and no token, hash or key appears in a log.

**Security model**:
- Roles: anonymous visitor, customer (any confirmed Supabase user; the `customers` row is created on demand), admin (spec 0004, unchanged). One auth user may be both. The admin gate (`requireAdmin()`, TOTP at `aal2`, `admin_users`, 12 hour limit) never reads customer state, and a customer session at `aal1` never passes it. A customer sign in never replaces an existing session (AC-4).
- Ownership: every query in `src/features/account/` filters by `getCustomerId()`. Order detail looks up by number and customer id together.
- Enumeration: sign up, resend and forgot password answer the same, at the same speed, for every email (Supabase runs in `after()`). Sign in shows one message for a wrong password, an unknown email and an unconfirmed account.
- Takeover: the password is chosen only after the confirm link (AC-1, AC-3). Admin and authenticator users always get the admin reset flow (AC-8), and change password refuses them (AC-19).
- Re-authentication: change password and delete account need the current password.
- Sessions: other sessions end when a password is chosen or changed. Sign out is local. Account pages are `no-store`, so Back after sign out shows nothing.
- Compliance: GDPR (EU store). PII is the profile (`name`, `phone`, `email`) and addresses. Deletion erases the profile, addresses, cart and login. Paid orders keep their snapshot (name, email, phone, address) unlinked, under the accounting retention duty (spec 0002); no retention period is set yet (Follow-up). Logs never carry PII (AC-24).
- Hook route: a public URL, protected by the Standard Webhooks signature and timestamp tolerance. It only sends to the address in a signed payload.

**Configuration required**:
- `SEND_EMAIL_HOOK_SECRET`: the Standard Webhooks secret (`v1,whsec_...`) shared by Supabase and the app, added to `src/lib/env.ts` and `.env.example`.
- `EMAIL_TRANSPORT`: gains the value `mailpit` (AC-23).
- `MAILPIT_URL`: Mailpit's base URL (local `http://127.0.0.1:55324`), required only with `mailpit`.
- `SEND_EMAIL_HOOK_URI`: read only by the Supabase CLI through `env()` in `config.toml` (local `http://host.docker.internal:<app port>/api/auth/send-email`). It is documented in `.env.example` as a CLI value, not in the app schema.
- Production (at deploy, feature 19), in the Supabase dashboard: sign up on, confirmations on, `/account/**` in the redirect URLs, and the Send Email Hook pointing at the production URL with the same secret. In Vercel: the Firewall rule (AC-26).

**Critical test scenarios**:
- Happy path: sign up with an email, read the confirm email in Mailpit, Continue, choose a password, land on `/account` and see an earlier guest order placed with that email, verifies **AC-1**, **AC-2**, **AC-3**, **AC-8**, **AC-10**, **AC-11**
- Happy path: signed in checkout with a saved default address, ticked save, order shows in history and as "Account" in admin, verifies **AC-15**, **AC-21**
- Happy path: the order's `customer_name` is the profile name when set, else the delivery full name (guests too), and a blank profile name is filled from it once, verifies **AC-15**
- Failure case: someone signs up with your unconfirmed email using a password they know (through the Supabase API); you confirm and choose your own; their password no longer works, verifies **AC-1**, **AC-3**
- Failure case: sign up with an existing email and with a new one give identical replies; a hook failure shows nothing on screen and logs `auth_email.failed`, verifies **AC-1**, **AC-8**
- Failure case: forgot password for an admin's email sends the admin email, and spec 0004's admin reset e2e passes through the hook, verifies **AC-8**, **AC-9**
- Failure case: guest cart and account cart with the same variant merge to the summed quantity capped at stock; two browsers signing in to one account at once leave one account cart; two address saves at once keep one default, verifies **AC-5**, **AC-14**
- Failure case: a deleted account's session from another device cannot read or write anything and does not recreate the row; delete refused for an admin; a failed admin API call leaves the account intact, verifies **AC-10**, **AC-20**
- Auth/permission: a leftover cookie naming an account cart, with no session, shows an empty `/cart` and the next add starts a guest cart, verifies **AC-7**
- Auth/permission: customer A opening customer B's order number sees not found; a signed out visitor on `/account` is redirected to sign in; Back after sign out shows no account data; a customer session cannot open `/admin`, verifies **AC-13**, **AC-22**

## Build plan

Tracer Bullet: the first task drives one real customer from sign up to their account page through every layer: Supabase config, the hook, the transport via Mailpit, the confirm and set password pages, the session, the DB and the proxy. Each later task thickens one segment end to end, with its own Vitest and Playwright coverage.

1. [x] Thin thread:
   * `supabase/config.toml`: sign up on, confirmations on, redirect URLs, the hook block via `env()`, `max_frequency`.
   * `SEND_EMAIL_HOOK_SECRET` and `MAILPIT_URL` in `src/lib/env.ts` and `.env.example`; the `mailpit` transport and its env rules; Playwright and CI switched to `mailpit`.
   * `standardwebhooks`, and the hook route with the confirm template only.
   * `signUp` and `/account/sign-up`; `/account/confirm` with `confirmEmail`; `/account/set-password` with `setPassword`.
   * `src/lib/customer/`: lock, session with `getUser()`, setup with upsert, stale row guard and order linking.
   * The proxy matcher and account branch (`no-store`, `Next-Action` skip), and a bare `/account` order list.

   Check early that the Supabase CLI substitutes `env()` in the hook `uri` and reaches the app from Docker in CI. E2E: sign up, confirm from Mailpit, choose a password, see an earlier guest order. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-10**, **AC-11**, **AC-13**, **AC-22**, **AC-23**
2. [x] Sign in and out: `signInCustomer` with safe `next`, the existing session redirect and the generic messages; `resendConfirmation`; `signOutCustomer` clearing the cart cookie; `src/lib/cart/merge.ts` with DB tests for every merge case and concurrent sign ins; `addToCart` attaching new carts. Satisfies **AC-4**, **AC-5**, **AC-6**, **AC-7**
3. [x] Password reset through the hook: customer and admin reset templates, the admin first template choice (`admin_users`, `auth.mfa_factors`), the unused type answer, `requestPasswordReset`, and the recovery Continue into `/account/set-password`. Then remove `supabase/templates/recovery.html` and keep the spec 0004 admin reset e2e green. Satisfies **AC-8**, **AC-9**
4. [x] Order history in full: pagination, status words, the `paid_at` filter, the order detail page, not found for every hidden case, DB tests for ownership. Satisfies **AC-11**, **AC-12**, **AC-13**
5. [x] Address book: `src/lib/customer/addresses.ts` (save, dedupe with null and empty treated alike, cap, default rules under the lock, "Check this address"), the page and its actions, DB tests for the default and cap races. Satisfies **AC-14**
6. [x] Checkout: signed in prefill (pending order first) and address list, read only email, the order's `customer_name` (profile name, else the delivery full name, for guest orders too, computed in the transaction outside `saveToAccount`), `saveAddress` and the name and phone profile fill in `startCheckout` (the name fill beside the phone fill, before the save box early return), `customer_name` added to the log redaction test, the merge with `cart_changed`, the sign in link, and the confirmation page button with `signUpFromOrder` and its eligibility rules. Satisfies **AC-15**, **AC-16**, **AC-17**
7. [x] Settings: profile, change password with the admin refusal, delete account with the admin refusal, the open order warning and the single transaction delete. Satisfies **AC-18**, **AC-19**, **AC-20**
8. [x] Admin badge on the order list and detail. Satisfies **AC-21**
9. [x] Safety net: the `account.*` and `auth_email.*` log events with a redaction test, axe on every account page (desktop and phone), the header Account link, the runbook additions for production (Supabase settings, redirect URLs, hook URL and secret, Firewall rule), and the account `AGENTS.md` facts handed to `/sync`. Satisfies **AC-22**, **AC-24**, **AC-25**, **AC-26**
10. [x] Review follow ups: `readOwnedCartId()` and the owned cart load in `src/lib/cart/`, wired into every AC-7 caller, `hasLiveCart` made live and owned, with DB tests (foreign cart for each action, a signed in customer holding another's cookie, a `getUser()` failure) and an e2e for a leftover cookie after the session ends; the `account.cart_merged` count (moved or summed, adoption included, none without a guest cart) and the `MergeOutcome` comment, with DB tests; the store admin guard on the signup password replace in `confirmEmail`. Satisfies **AC-5**, **AC-7**, **AC-24**

## Consequences

**Positive**:
- No new auth vendor and no migration: the tables from spec 0002 and the session code from spec 0004 carry the feature.
- All mail (order and auth) shares one look, one sender and one transport, and e2e can now read every email from Mailpit.
- The shared reset template problem from spec 0004 is fixed in code, and admin passwords keep needing the authenticator to reset.
- Sign up reveals nothing about which emails have accounts, and a planted password never survives a confirm.
- Guests lose nothing: checkout is unchanged for them, and their earlier orders appear the moment they make an account.

**Negative / tradeoffs**:
- Auth email delivery now depends on our app being up. If the hook route or Resend is down, nobody can sign up or reset a password (admins included) until it recovers. Supabase's own mailer is no longer a fallback, and the failure shows only in logs, not to the customer.
- Sign up takes three steps (email, link, password) instead of two.
- Every account request makes one `getUser()` call to Supabase.
- Local and CI setups gain a moving part: the Supabase container must reach the app at `SEND_EMAIL_HOOK_URI`, and the port must match the dev server (3000 or 3100).
- Admins and customers share one session per browser: signing out on the storefront signs an admin out of `/admin` in that browser.
- Someone who places a guest order with your email puts that order, with their delivery address, into your history once linked. They already sent the confirmation to your inbox, so nothing new is revealed, but it can confuse.
- After deletion, paid orders keep their PII for accounting with no retention limit yet, and signing up again with the same email re-links them.
- A guest cart merged away on sign in may leave its pending checkout order with `cart_id` null. That Stripe session can still be paid until it expires, and a customer who pays both it and a new checkout gets two orders.
- No email change and no data export in this feature.
- On a gift order, a guest (or a signed in customer with no profile name) is greeted by the recipient's name, and that name can become their profile name. They can change it in settings.

**Neutral**:
- `/checkout` now passes through the proxy for session refresh.
- `addToCart` reads the session only when it creates a cart.
- Order emails now greet by first name (spec 0011's `greetingName` already reads `customer_name`), and admin order search now matches it (spec 0010).
- Spec 0004's AC-10 note "Public sign up is off" and its recovery template no longer hold; spec 0004 carries an amendment line pointing here.
- A browser with a leftover account cart cookie still shows that cart's item count in the header after the session ends, until the next add replaces the cookie. It is only a number, and keeping it avoids a Supabase call on catalog pages.
- A signed in customer's own cart costs one more `getUser()` on each `/cart` and `/checkout` view and each cart action.

## Follow-up

- [x] Amend spec 0004: public sign up is on (spec 0004 AC-10), and the admin reset email is sent by the hook from this spec, not `supabase/templates/recovery.html`.
- [ ] Customer email change through Supabase secure email change, keeping `customers.email` and order linking in step (deferred by decision).
- [ ] Data retention for paid orders: set the accounting retention period, then extend the spec 0008 purge to settled orders past it. Add a data export (GDPR access and portability) for account holders.
- [ ] Spec 0011 follow-up: order emails can now link to `/account/orders/[number]` for account orders.
- [ ] Production (feature 19): Supabase sign up and confirmations on, `/account/**` redirect URLs, Send Email Hook URL and secret, Firewall rule for `/account/*` and `/checkout/complete`.
- [ ] An admin customers page (search customers, see their orders) as its own feature if support needs it.
- [ ] `/sync`: add `src/features/account/AGENTS.md`, record `src/lib/customer/` and the hook route in root `AGENTS.md`, and add the hook to the route handler list in the Rules (Stripe webhook, auth callback, cron, and now the auth email hook).
