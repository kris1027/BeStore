# 0012. Customer accounts: rationale

## Context

Every order so far is a guest order. A customer who wants to know where an order is has only the confirmation email and a confirmation URL keyed by the Stripe session id. They retype their address at every checkout. Scope feature 12 asks for optional accounts: sign up, sign in, password reset, past orders, a saved address, guest checkout unchanged, and earlier guest orders visible once a guest makes an account with the same email.

Much of the ground is already laid. Spec 0001 chose Supabase Auth through `@supabase/ssr` for both admins and customers. Spec 0002 created `customers`, `customer_addresses` and a nullable `carts.customer_id`, and planned guest order linking by verified email. Spec 0004 built the admin side on the same Supabase project: public sign up off, a password policy that applies to every user in the project, one recovery email template titled for admins, the scanner safe confirm page, and the rule that one auth user may be both an admin and a customer. Its follow up says this feature must turn sign up back on, widen the proxy, give customer reset its own email, and keep the admin check independent of customer state.

The forces: the store is small and EU based (GDPR applies to profiles and addresses), there are no deploys yet, and spec 0004 decided storefront pages never call Supabase so the catalog stays cached. Sign in is money adjacent (saved addresses, order history), so the feature carries the GA tier. Supabase Auth email templates are configured per project, not per audience, so admins and customers would receive the same reset email unless the store takes over sending. Supabase only accepts one Send Email Hook per project, and when it is on, Supabase sends nothing itself, which removes the Mailpit capture the admin reset e2e uses today.

## Options considered

### Option 1: Supabase Auth, shared user pool, our own Send Email Hook

Customers sign up with email and password in the same Supabase project as admins. Supabase calls our route for every auth email; the route picks the customer or admin template and sends it through the existing Resend transport with React Email.

**Pros**:
- No new vendor; reuses the session plumbing, proxy and confirm pattern from spec 0004 and the email stack from spec 0011.
- Admin and customer emails differ, and every email shares one look and one sender.
- E2E reads auth emails from Mailpit through the new transport, which also makes order emails checkable.

**Cons**:
- Auth emails stop when the app or Resend is down; no Supabase fallback.
- The hook needs a signature check, a route, three templates, and the CLI must reach the app from Docker.

### Option 2: Supabase Auth, shared user pool, Supabase SMTP templates

Same accounts, but keep Supabase's mailer: reword the recovery template to neutral wording and let the link's `next` decide where it lands.

**Pros**:
- Least code: two template files and config.
- Supabase keeps sending even if the app is down.

**Cons**:
- Admins and customers get the same reset email; the copy can't speak to either.
- Templates are Go HTML outside React Email, so two template systems and two looks.
- Production needs Resend SMTP credentials configured in Supabase separately from the app's key.

### Option 3: A separate auth system for customers

A second Supabase project, or a hosted provider, only for customers, so admin and customer identities never mix.

**Pros**:
- Full isolation: customer sign up can never touch an admin user, sessions are separate.
- Each pool gets its own password policy and templates.

**Cons**:
- Two sets of keys, cookies, proxies and session code; spec 0001 picked one platform to avoid exactly this.
- A hosted provider is a new paid vendor for a feature Supabase already covers.

### Option 4: Passwordless email codes

Customers sign in with a 6 digit code by email, no password at all.

**Pros**:
- No password storage, no reset flow, no password change or re-authentication screens.

**Cons**:
- Every sign in needs the inbox, which adds friction at checkout, the moment it matters most.
- The scope asks for password reset, so it changes the requirement rather than meeting it.
- Shares the project wide email template problem of Option 2.

## Rationale

The project already runs on one Supabase project with a working session layer, so accounts belong there (Options 1 and 2), not in a second identity system (Option 3) that doubles the auth surface for a store with a few admins. Passwords stay (not Option 4) because the scope asks for reset and because checkout is the worst place to make someone fetch a code.

Between 1 and 2, the deciding force is that Supabase templates are per project. With Option 2 an admin and a shopper get the same reset email, which spec 0004 already flagged as a problem, and the store would run two template systems. The hook moves that choice into code we test, reuses the Resend transport and React Email from spec 0011, and gives e2e real emails through Mailpit. Its real cost is that auth mail depends on the app being up; for a monolith whose checkout already depends on the same app, that adds little new risk, and the route is small.

The rest of the design follows the same instinct to reuse: the account cart is the existing `carts` row, the address book is the existing table, linking is one `UPDATE` on an indexed column, and the header stays a static link so the catalog keeps its cache and spec 0004's promise that storefront pages never call Supabase.

### Amendment (2026-10-14): where the order's customer name comes from

AC-15 said a blank `customers.name` is filled from the order's `customer_name`, but nothing ever set `customer_name`: checkout writes only `ship_full_name`. So the fill had no source, order emails always said "Hello,", and admin search on that column never matched. Four options were weighed: the profile name else the delivery full name (chosen), always the delivery full name, the Stripe billing name from the webhook, and dropping the column. The chosen rule needs no new field, is known before payment so the fill stays in `startCheckout`, and respects a name the customer chose. Its cost is that a gift order from someone with no profile name greets them by the recipient's name, which they can correct in settings. No backfill, since nothing is deployed.
