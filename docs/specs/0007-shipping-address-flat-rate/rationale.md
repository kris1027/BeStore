# 0007. Shipping address and flat rate delivery: rationale

Decision record for [index.md](index.md).

## Context

Slice 1 sells without asking where to send anything: checkout collects only an email, and `snapshotOrder` hardcodes `shipping_cents` to 0. The scope (feature 8) asks for a delivery address and one flat delivery fee that becomes free above an amount the admin sets. The store sells in one country (Poland), in one currency, and ships at a flat rate; zone or weight based rates are explicitly out of scope.

Forces at play. Money is involved, so the charge must be computed on the server from the database, frozen on the order before payment, and match what Stripe collects (spec 0006 flags any order whose `amount_total` differs). The schema from spec 0002 already has nullable address columns on `orders`, a `phone` column, `shipping_cents`, and a one row `store_settings` table with `flat_shipping_cents` and `free_shipping_threshold_cents`. Orders made in Slice 1 have no address. Addresses and phone numbers are personal data under GDPR. Feature 12 (accounts) will add saved addresses and wants to prefill checkout. Catalog reads are cached with tags, and the cart page renders on every visit.

If this is not decided, the store cannot ship paid orders, and every later feature that shows a total (emails, discounts, the sales dashboard) builds on a total that leaves out delivery.

## Options considered

### Option 1: Our address form, fee computed on our side, Stripe shipping option

The customer types the address on `/checkout` beside the email. `startCheckout` validates it, reads `store_settings` in the order transaction, computes the fee, and saves both on the pending order. The Stripe session gets one `fixed_amount` shipping option for that fee plus `payment_intent_data.shipping` with the address.

**Pros**:
- The address and fee exist on the order before payment, so admin, confirmation page and future emails read one frozen record.
- The customer sees the real total on our page and the Pay button.
- Feature 12 can prefill saved addresses into our form.
- Stripe shows a proper delivery row, and `amount_total` matches `total_cents`.

**Cons**:
- We build and maintain the form, its validation and its accessibility.
- No built in address autocomplete or verification.

### Option 2: Stripe collects the address on its hosted page

Set `shipping_address_collection` limited to PL and pass the fee as a shipping option. The webhook copies `collected_information.shipping_details` onto the order when it marks it paid.

**Pros**:
- No form code; Stripe handles address inputs, localization and autocomplete.
- Fewer fields on our page.

**Cons**:
- The address reaches us only at paid, through the webhook; the pending order has none, and the webhook (the one path that marks paid) gains a second job.
- Accounts (feature 12) cannot prefill a guest's saved address on Stripe's page without creating Stripe Customers.
- The address shape is Stripe's; our postal format rule cannot be enforced before payment.

### Option 3: Our form, fee as an extra line item

Same as Option 1, but delivery is sent as a line item called "Delivery" instead of a shipping option.

**Pros**:
- Simplest Stripe params; no shipping rate object.

**Cons**:
- The receipt and Stripe reports show delivery as a product; `total_details.amount_shipping` stays 0, so Stripe side reporting is wrong.
- A zero fee line item is awkward (Stripe line items for 0 read oddly), so free delivery needs a special case.

## Rationale

Option 1 keeps the rule that spec 0006 made central: the order is frozen before payment and the webhook only marks it paid. Computing the fee inside the same transaction that locks the cart means the customer is charged the settings in effect at Pay, and the Stripe total always equals `total_cents`, so the amount mismatch alarm keeps its meaning. Option 2 would move the address into the webhook and leave pending orders without one, which complicates the one path that handles money, and it blocks the prefill that feature 12 needs.

Option 3 was close, but a real shipping option gives correct Stripe reporting and a natural "Free delivery" row at 0, for the same amount of code. Sending `payment_intent_data.shipping` as well costs one object and gives Stripe's fraud checks and the dashboard the address.

The address stays nullable in the database by the engineer's choice: Slice 1 orders have none, and a `NOT VALID` CHECK would force every test fixture to carry an address for a guarantee the Zod schema already gives. The rule and address schema go into `src/lib/shipping/` because three features use them and the project forbids cross feature imports. Settings shown on the cart and checkout come from a tagged cached read because they change rarely; the charge itself never trusts the cache.
