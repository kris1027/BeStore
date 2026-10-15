# Verify: customer accounts · spec 0012 · updated 2026-10-14
_Steps derived from spec 0012 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Local setup: `pnpm db:start` (the stack reads `SEND_EMAIL_HOOK_URI` and `SEND_EMAIL_HOOK_SECRET` from `.env.local`), `EMAIL_TRANSPORT=mailpit`, `pnpm dev` on the port the hook URI names. Emails show in Mailpit at http://127.0.0.1:55324.

## UI / manual
- [ ] `/account/sign-up` with a new email, an existing confirmed account's email and an admin's email → the same "Check your email" screen with "Send the link again" every time; Mailpit gets a "Confirm your email" only for the new one → AC-1
- [ ] Sign up with `Ada@Example.COM` → the auth user and later the `customers` row hold `ada@example.com` → AC-1
- [ ] Stop Mailpit or break the hook secret, sign up → the screen is unchanged; the log has `auth_email.failed` or `auth_email.bad_signature`, never the address → AC-1, AC-8, AC-24
- [ ] Open the confirm link with `curl` (a scanner) → 200, `Referrer-Policy: no-referrer`, the token still works afterwards → AC-2
- [ ] Continue on the confirm link → `/account/set-password`; Continue again on the same link → "This link has expired or was already used." with the resend form → AC-2
- [ ] `/account/confirm?type=magiclink&token_hash=x` and a link with no hash → the expired message, no Continue → AC-2
- [ ] On `/account/set-password`, type `short` → every missing part named; a password from a leak (with HIBP on in production) → the leaked message; the old password after a reset → "Choose a password you have not used here before." → AC-3
- [ ] Choose a password with a second browser signed in to the same account → lands on `/account` with "Your account is ready."; the other browser is signed out → AC-3
- [ ] Plant a password through the Auth API before the owner confirms; the owner confirms and chooses theirs → the planted password no longer signs in → AC-1, AC-3
- [ ] `/account/sign-in` with a wrong password, an unknown email, an unconfirmed account → the same "That email and password do not match." → AC-4
- [ ] Sign in with `next` set to `/checkout`, `/account/orders/1001`, `//evil.example`, `/account/sign-in`, `%2F%2Fevil.example` → only the first two are followed, the rest land on `/account` → AC-4
- [ ] Signed in as an admin at `/admin`, open `/account/sign-in` → sent to `/account`, and `/admin` still works → AC-4
- [ ] Guest cart with variant X ×4 and an account cart with X ×5 (stock 7) → after sign in the cart holds X ×7, the guest cart row is gone, a pending order on it keeps its row with `cart_id` null → AC-5
- [ ] Two browsers sign in to one account at the same moment, each with a guest cart → one account cart → AC-5
- [ ] Sign out → home page, the cart cookie is gone, Back does not show the account page; sign in again → the cart is back → AC-6
- [ ] Signed in with no cart cookie, add to cart → the line lands in the account cart (`carts.customer_id` set) → AC-7
- [ ] Forgot password for a customer → "Reset your password" email linking to `/account/confirm?...&type=recovery`; for an admin or a user with an authenticator → "Reset your admin password" linking to `/auth/confirm` → AC-8, AC-9
- [ ] Paste an admin's reset token into `/account/confirm?type=recovery` → Continue goes to the authenticator step, never to `/account/set-password` → AC-8 (Key invariants)
- [ ] Forgot password for an unknown email → the same reply, no email → AC-9
- [ ] A guest order placed earlier with the email shows on `/account` after sign up; a pending one does not, until it is paid → AC-10, AC-11
- [ ] `/account` with 21 paid orders → 20 on page 1 (newest paid first), 1 on page 2 with Previous; status words Paid, Shipped, Delivered, Cancelled; item count and total → AC-11
- [ ] `/account/orders/<n>` shows lines, subtotal, discount when above 0, "Free" delivery when 0, total, "Refunded" when above 0, address, carrier and tracking → AC-12
- [ ] Another customer's order number, a guest order's number, a pending order's number and a missing number → the same not found page → AC-13
- [ ] Signed out, open `/account/settings` → 307 to `/account/sign-in?next=%2Faccount%2Fsettings` with `Cache-Control: no-store` → AC-13
- [ ] Address book: add two, the first is default; make the second default; delete the default → the newest remaining becomes default; at 10 the Add button is replaced by "You can save up to 10 addresses."; a row with postal code `12345` shows "Check this address" → AC-14
- [ ] Signed in checkout: the email is read only and is the account email; the form starts with the pending order's address, else the default address; the saved address list swaps the fields; "Save this address to my account" is ticked → AC-15
- [ ] Pay with the box ticked → the order has `customer_id`, the address is saved once (paying again with the same address adds nothing); a blank profile phone is filled from the order → AC-15
- [ ] Order `customer_name`: signed in with profile name "Ada Lovelace", shipping to "Grace Hopper" → the order's `customer_name` is "Ada Lovelace" and the confirmation email says "Hi Ada,"; with a blank profile name → `customer_name` is "Grace Hopper" and the profile name becomes "Grace Hopper" (a set name is never overwritten); a guest order → `customer_name` is the delivery full name; with the save box unticked the blank profile name is still filled; admin search by that name finds the order; paying does not change `customer_name` (the webhook leaves it alone) → AC-15
- [ ] Guest cart plus an account cart with lines, signed in, Pay → "Your cart was updated with items saved in your account. Check it and pay again." and the merged cart shows → AC-15
- [ ] Signed out on `/checkout` → "Have an account? Sign in" → back on `/checkout` with the merged cart and the default address → AC-16
- [ ] `/checkout/complete` for a paid guest order, signed out → "Create an account to track this order" → "Check your email" and a confirm email to the order's email; signed in, or for a pending order or an account order → no button → AC-17
- [ ] `/account/settings`: save name and phone; phone `123` refused with checkout's message; "To change your email, contact us." → AC-18
- [ ] Change password: wrong current → "Your current password is not right."; success → other sessions end, this one stays; as an admin or a user with an authenticator → refused with the admin message → AC-19
- [ ] Delete with a paid, unshipped order → the warning names the count and the email; wrong password → refused; right password → home page with "Your account is deleted.", the login is gone, the paid order keeps its snapshot with `customer_id` null; as an admin → refused → AC-20
- [ ] `/admin/orders` and an order page show "Account" for a linked order and "Guest" for the rest → AC-21
- [ ] The header has an "Account" link on every store page; a product page makes no call to Supabase (no `sb-` cookie work in the proxy log) → AC-22
- [ ] Every account page passes axe on desktop and phone, works by keyboard, and focuses the first invalid field on a refused submit → AC-25

## Value sourcing
- [ ] Throwaway password: inspect a sign up in the Auth logs, it is never the typed value and never logged → AC-1
- [ ] Hook link: set `NEXT_PUBLIC_SITE_URL` to another host → the link in the email uses it → AC-8
- [ ] Hook recipient: the email goes to `user.email` from the signed payload, never to a value the browser sent → AC-8
- [ ] Hook template: a non admin user with a `redirect_to` of `/auth/confirm` still gets the customer reset; an admin with a `redirect_to` of `/account/set-password` still gets the admin reset → AC-8
- [ ] Idempotency key: `auth:<type>:<sha256>` in the Resend dashboard, never the token hash → AC-8
- [ ] Account id and email for setup come from the user Supabase returned (sign in as one user while the browser holds another's stale cookie → the signed in user's orders link) → AC-10
- [ ] Merge line cap: lower the stock between adding and signing in → the merged line stops at the new stock → AC-5
- [ ] Dates on `/account`: set `STORE_TIMEZONE` to a far zone and pay near midnight UTC → the paid date follows the store's day → AC-11
- [ ] Checkout email: type another email while signed in → the order and Stripe get the account email → AC-15
- [ ] Prefill: a cart with a pending order → its address wins over the default address → AC-15
- [ ] Address book country: the store's country only, never editable → AC-14
- [ ] `signUpFromOrder` email: tamper with the button's request body → the email still comes from the order → AC-17
- [ ] Open order count: one `paid` and one `shipped` order → the warning says 1 → AC-20
- [ ] Admin badge: unlink an order (`customer_id` null) → it shows Guest → AC-21

## Commands
- [ ] `pnpm test` → all unit tests pass, including `src/lib/email/send-auth-email.test.ts`, `src/features/account/actions/auth-actions.test.ts` and `src/lib/customer/log.test.ts` → AC-1 to AC-4, AC-8, AC-9, AC-24
- [ ] `pnpm test:db` → all db suites pass, including `account-setup`, `account-orders`, `account-addresses`, `account-settings`, `order-sign-up`, `cart-actions` and `start-checkout` → AC-5, AC-7, AC-10 to AC-15, AC-17 to AC-21
- [ ] `pnpm test:e2e tests/e2e/account tests/e2e/admin/password-reset.spec.ts` → every account flow and the spec 0004 admin reset pass through the hook → AC-1 to AC-25
- [ ] `pnpm build` → the account pages build as partial prerender with no Cache Components errors → AC-25

## Acceptance-criteria coverage
- AC-1 sign up and resend · AC-2 confirm link · AC-3 choose password · AC-4 sign in and `next` · AC-5 cart merge · AC-6 sign out · AC-7 add to cart for a customer · AC-8 the hook · AC-9 forgot password · AC-10 account setup · AC-11 order list · AC-12 order page · AC-13 not found and the proxy · AC-14 address book · AC-15 signed in checkout · AC-16 sign in from checkout · AC-17 account offer · AC-18 profile · AC-19 change password · AC-20 delete account · AC-21 admin badge · AC-22 header link and proxy matcher · AC-23 Mailpit transport and config · AC-24 logs · AC-25 accessibility · AC-26 runbook (applied at deploy, feature 19)
