# 0014. Discounts and promo codes: rationale

Decision record for [index.md](index.md). `/develop` builds from the index; this file explains why.

## Context

BeStore sells in one country and one currency with flat rate delivery (spec 0001), and the scope promises admin created promo codes, percent or fixed amount, with dates and usage limits, applied at checkout. The scope's done condition is strict: a valid code lowers the total correctly before payment, expired, used up or invalid codes are refused with a clear message, and the discount is saved on the order and carried into refunds. This is a GA tier feature because it changes how much money is taken.

Most of the ground is already laid. Spec 0002 created `discount_codes`, `discount_redemptions` and the `orders.discount_*` snapshot columns, defined the redemption pattern (lock the code row, count, insert) and its race test, and left two questions for this feature: how to keep a discounted total above Stripe's minimum charge, and how to split an order discount across lines. Spec 0006 freezes the cart into a pending order before payment and sends Stripe inline prices, spec 0007 makes delivery depend on `subtotal - discount`, spec 0010 refunds from per line totals, and specs 0011 and 0012 already show a discount row when it is above 0.

The forces: the amount Stripe charges must equal our order total exactly (the webhook flags any mismatch); the last use of a limited code must never be sold twice; prices and rules must come from the database, never the browser; checkout must stay a single form with no extra pages; and the store has a few admins and a small catalog, so the admin side should be simple. Leaving this undecided would mean the first build guesses the Stripe hand off and the rounding, which are the two places a wrong guess costs money or trips the mismatch alarm.

## Options considered

### Option 1: Our own codes, checked twice, discount split onto lines, a one off Stripe coupon per order

Codes and limits live in our tables. Apply previews the discount; Pay rechecks under the code row lock, writes the discount onto the order and its lines, and holds a use. After the order commits, we create a single use Stripe coupon with our exact amount and attach it to the Checkout Session.

**Pros**:
- Stripe's `amount_total` equals our total by construction; no rounding gap between two calculators.
- Stripe's page shows a proper discount row under the code's name.
- Limits, dates and per customer rules use the lock pattern spec 0002 already tested.

**Cons**:
- One extra Stripe call per discounted checkout, and coupons pile up in the Stripe dashboard.
- We own all the discount math and its tests.

### Option 2: Our own codes, discount baked into line prices

Same checks, but the discount lowers each line's `unit_amount` sent to Stripe, with no Stripe discount object.

**Pros**:
- No extra Stripe call and nothing created in Stripe.

**Cons**:
- A line discount that does not divide by the quantity forces splitting a line into two Stripe lines with different unit prices.
- Stripe's page shows lower prices with no discount row, which looks like a price change, not a promo.

### Option 3: Mirror each admin code as a Stripe coupon or promotion code

Each code is created once in Stripe (percent or amount), and either we pass it to the session or Stripe's own promo code box collects it.

**Pros**:
- Stripe does the math and shows the discount; Stripe's own box needs no field on our side.

**Cons**:
- Stripe's percent rounding and per line allocation can differ from ours, tripping the amount mismatch check and making our order snapshot disagree with the charge.
- With Stripe's box, the code is applied after our order is frozen, so our order, delivery threshold, limits and redemptions would not know about it until the webhook.
- Two systems hold the code's rules and must be kept in step on every edit.

### Option 4: Code stored on the cart, applied on `/cart`

Keep Option 1's Stripe hand off, but store the applied code on the cart so `/cart` and `/checkout` both show it.

**Pros**:
- Customers see the saving earlier.

**Cons**:
- A new cart column and a second place to check and clear the code (cart changes, expiry, merges on sign in).
- The per customer limit cannot be checked on `/cart` (no email yet).

## Rationale

Option 1 is the only one where the amount Stripe charges is our number by construction. That matters more than anything else here: spec 0006's webhook compares `amount_total` to `orders.total_cents` and flags a mismatch, and spec 0010's refunds work from our line totals, so if Stripe computed the discount (Option 3) every rounding difference would become a flagged order and a refund that does not match the charge. Option 2 also keeps our number, but it hides the discount from the customer on Stripe's page and forces split lines; one coupon call per order is a cheaper price than that.

Checking twice (Apply, then Pay under the lock) follows the existing checkout rule that Pay reads everything live inside the cart lock (specs 0006, 0007). Apply is only a preview; the lock at Pay is what makes "the last use is never sold twice" true, using spec 0002's tested redemption pattern. Holding the use while the order is pending is what lets the lock work: counting only paid orders would let two customers pay with the last use.

Keeping the code on `/checkout` only (not Option 4) keeps the cart free of discount state and puts the code next to the email, which the per customer limit needs. The cap to Stripe's minimum and the largest remainder split settle the two questions spec 0002 left open, in a way that never blocks a customer and keeps per unit refunds fair. Rules sit in `src/lib/discounts/` because checkout and the admin both need them and the project forbids one feature importing another's internals.
