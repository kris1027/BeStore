# 0004. Admin sign in: rationale

Decision record for [index.md](index.md). `/develop` builds from `index.md`; this file explains why.

## Context

BeStore's admin panel will soon edit the catalog (feature 9), change order status and refund real money through Stripe (feature 10). Whoever signs in to `/admin` can do all of it. The scope marks this feature `GA` because it touches sign in, and the tracer bullet slice (features 5 to 7) needs a real admin before a product can exist. A few admins, one role, no public sign up.

Spec 0001 already fixed the platform: Supabase Auth through `@supabase/ssr` cookie sessions, a Next.js proxy that refreshes the session and gates `/admin` as a first check, and a `requireAdmin()` that every admin page, action and route handler calls itself. Spec 0002 already fixed the data: `admin_users` keyed by the auth user id, with `disabled_at` instead of deletion, because orders and refunds point at the admin who acted. What neither spec settled: how admins prove who they are, where the admin role is read from, how strong a session must be and for how long, how admins are created and recovered, and what anyone else sees.

The forces: the only people who ever sign in here are a handful of trusted staff, so friction is cheap and breaches are expensive. It all runs on Vercel serverless functions and the Supabase free or entry plan, so features locked behind paid plans (time boxed sessions, leaked password checks) are not a given. A single developer operates it, so every moving part (an admin UI, a second auth vendor, stored recovery codes) is something they alone must secure and maintain. Customer accounts arrive later on the same Supabase project, so admin rules must not leak into, or depend on, customer sessions.

Not deciding leaves `/develop` to invent the security boundary for the most privileged surface in the app, which is the one place a guess is least acceptable.

## Options considered

### Option 1: Supabase password plus required TOTP, role from `admin_users` on every request

Email and password through Supabase Auth, then a required authenticator app code (Supabase's built in TOTP MFA). `requireAdmin()` confirms the user with the Auth server, requires assurance level `aal2`, enforces a 12 hour cap, and reads the live `admin_users` row.

**Pros**:
- Two factors on the account that can refund money, at no extra cost or vendor.
- Disabling an admin takes effect on the next request.
- All rules sit in one pure, testable function.

**Cons**:
- One Auth server call and one DB query per admin request.
- More screens (enroll, verify) and a recovery path for lost devices.
- Admins type a code at least daily.

### Option 2: Role as a JWT claim (custom access token hook)

Same sign in, but a Supabase access token hook writes `is_admin` into `app_metadata` claims, and the guard reads only the token, with no DB lookup.

**Pros**:
- No DB query per request; the guard is fully local.
- The role is visible to any code holding the token.

**Cons**:
- A disabled admin keeps access until their token refreshes (up to an hour), which is exactly when you need it gone.
- A Postgres function in the auth hook path to write, secure and test.
- The role now lives in two places (the table and the claim) that can disagree.

### Option 3: A hosted auth provider for admins

A separate hosted identity product for the admin panel, with its own MFA and user management UI.

**Pros**:
- Polished MFA, device management and admin invites out of the box.
- Admin identity fully separated from future customer accounts.

**Cons**:
- A second auth vendor next to Supabase, against spec 0001's "reuse the platform" choice, with its own bill, SDK and outage risk.
- Two session systems in one Next.js app, and the `admin_users` link to orders must map a foreign user id.

### Option 4: Password only, MFA later

Option 1 without the TOTP step.

**Pros**:
- The smallest build: one form, one action, one guard.
- No enrollment or recovery flows.

**Cons**:
- A phished or reused password gives full control of refunds and the catalog.
- Adding MFA later means changing every admin's sign in and adding the `aal2` check to a guard many features already depend on.

## Rationale

Option 1 fits the forces best. The panel will move real money within three slices, and the people using it are few and trusted. That is exactly the case where a second factor costs little (a daily code for a handful of staff) and prevents the most likely real attack, a reused or phished password. Supabase already ships TOTP on every plan, so it adds no vendor and no bill, which a single developer operation needs.

Reading the role from `admin_users` on every request (instead of a claim, Option 2) is what makes "disable" mean something. The table was built in spec 0002 so admins are disabled rather than deleted; a claim would let a disabled admin keep acting for up to an hour. The price is one indexed primary key lookup per admin request, negligible for a few users. Option 3 solves problems BeStore does not have (large admin teams, enterprise SSO) at the cost of a second auth system. Option 4 is cheaper today, but it defers a change into a guard every later admin feature will depend on, and it ships a money moving panel behind one factor.

The smaller calls follow the same logic. The 12 hour cap is enforced by the app from the token's `amr` timestamps, because Supabase's own session time box needs a paid plan and this project does not assume one. Scripts instead of an admin UI keep the attack surface at zero screens, at the cost of needing a terminal for account changes, which suits one owner and a few admins. Uniform 404s and a single failure message keep the panel from confirming who is an admin. Reset requiring TOTP stops an inbox compromise from becoming an account compromise.

## Password policy note

You picked 8 characters with all four character classes. That works, and TOTP carries most of the real protection here. For the record, length does more than complexity against guessing, so 12 characters with letters and digits would be slightly stronger and easier to type. Since the rule also binds customer accounts in feature 12, it is worth a second look then.
