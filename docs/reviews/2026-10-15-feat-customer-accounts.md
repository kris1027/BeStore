# Review, feat/customer-accounts, 2026-10-15

**Reviewed by**: Sonnet 5.5 (author on a different model per the check skill)
**Scope**: 162 files, branch vs main
**Verdict**: Changes requested

## Summary
This branch adds optional customer accounts on the shared Supabase user pool, a signed Send Email Hook route, an address book, cart merge, signed in checkout and account deletion. The code is careful and consistent: queries filter by the session customer id, the hook verifies the signature before anything else, and sign up and reset never reveal whether an account exists. The headline issue is that the "choose your password after confirming" defence has a hole. A password planted by an attacker survives if the real owner confirms the email and then leaves without choosing a password.

## Major
### 🟠 A planted password survives when the owner confirms and does not set one, `src/features/account/actions/confirm.ts:34`
**Problem**: Supabase sign up is public (`enable_signup = true`), so anyone can call it directly with the victim's email and a password they know. Our hook then mails the victim a genuine "Confirm your email" link. The design says the owner's new password overwrites the planted one, but AC-3 also lets the owner leave the set password page. After `verifyOtp` the user is confirmed and signed in, and the attacker's password is still valid.
**Why it matters**: The attacker signs in with the planted password. Account setup then links every guest order for that email, so the attacker sees the victim's order history, names, phones and delivery addresses. The throwaway password in `sendSignUp` only protects sign ups made through our own form, not direct API calls.
**Suggested fix**: When a `signup` token is spent, immediately replace the password with a fresh throwaway one (service role `updateUserById`, or `updateUser` in the new session) before redirecting, so only a password chosen after the confirm can ever exist. Alternatively keep the account unusable (not linked, no orders shown) until a password has been chosen, tracked by a flag in user metadata. Add a db or action test for "confirm, abandon, old password no longer signs in".

## Minor
### 🟡 Signed out visitors can use a customer's cart through a leftover cookie, `src/features/cart/actions.ts:39`
**Problem**: `hasLiveCart` only checks that the cookie cart exists and has not expired, not who owns it. If a customer's session ends without our sign out (expiry, sign out from another device, an admin sign out in the same browser), the cart cookie still names their account cart. A guest on that browser then reads and adds to that customer's cart.
**Why it matters**: Cart contents leak and get changed on shared computers. Money and addresses are not exposed, so this is not a blocker.
**Suggested fix**: In the cart read and add paths treat a cookie cart that has a `customer_id` as foreign when the visitor has no matching session, and start a guest cart instead. Or clear the cart cookie in the proxy when there is no session on account pages.

### 🟡 Merging a guest cart can orphan an open Stripe session, `src/lib/cart/merge.ts:79`
**Problem**: The merge deletes the guest cart, which sets `cart_id` null on any pending order. `clearPendingOrder` in `startCheckout` then looks up pending orders by the account cart id, so it never finds the old one and its Stripe session stays open.
**Why it matters**: A guest who started checkout, went back, signed in and paid again can end up with two payable sessions for the same goods. The spec accepts the null `cart_id`, but not the duplicate payment path.
**Suggested fix**: Before deleting the guest cart, expire its pending order's session (the same way `clearPendingOrder` does), or refuse the merge while a pending order exists.

### 🟡 Set password accepts any session without the current password, `src/features/account/actions/set-password.ts:31`
**Problem**: Anyone holding a valid customer session can change the password here with no re-check. The change password form does ask for the current one, so the two are inconsistent.
**Why it matters**: A stolen or left open session becomes a permanent account takeover. It is the documented design (the page must work right after a confirm link), so it is minor.
**Suggested fix**: Only allow this page for a session that came from `verifyOtp` in the last few minutes (for example a short lived marker cookie set by `confirmEmail`), and send everyone else to change password.

### 🟡 Account deletion holds a database transaction open across a network call, `src/features/account/actions/settings.ts:113`
**Problem**: The advisory lock and an open Prisma transaction wait on `auth.admin.deleteUser` for up to 15 seconds.
**Why it matters**: Slow Auth responses tie up pooled connections. Rare, because it only runs on deletion.
**Suggested fix**: Acceptable for now. Note it in the runbook, and keep the 15 second cap.

## Nits
- ⚪ `src/features/admin-auth/actions/mfa.ts:10`, the moved imports (`@/lib/auth/errors`, `@/lib/form-errors`, `@/lib/supabase/session`) sit among the relative imports; group them with the other `@/` imports (same in `password-reset.ts` and `sign-in.ts`).
- ⚪ `src/features/account/actions/sign-up-from-order.ts:17`, the eligibility lookup runs before `after()`, so its reply differs slightly from a non eligible one. Harmless because it says nothing about accounts.

## Strengths
- The Send Email Hook checks the Standard Webhooks signature over the raw body first, refuses every action type except signup and recovery, picks the admin template from the database (not from `redirect_to`), and uses a hashed idempotency key.
- Order, address and profile reads and writes always filter by the session customer id; an order that is missing, foreign or hidden gives the same not found.
- The `getUser()` choice, the per customer advisory lock, the confirm link that only a POST spends, and safe `next` handling are well reasoned and carry why comments.
- Logs carry only ids, counts and reason codes, backed by a redaction test.

## Test coverage
Good. Vitest covers the hook (signature, types, template choice), the actions, paths and `next` safety, password errors, proxy decisions, log redaction and env rules. The db project covers setup, order linking, address rules and limits, settings, deletion and sign up from an order. Playwright covers sign up, sign in, reset, settings, addresses, orders, checkout and axe on each page. The gap is the abandoned confirm scenario above (a planted password still works), and no test covers a signed out visitor with a leftover account cart cookie.
