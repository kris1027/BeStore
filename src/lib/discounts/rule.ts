import { formatMoney, type MoneyFormat } from "@/lib/money";
import { orderCharges, type ShippingSettings } from "@/lib/shipping/rule";

// Pure: the only place a discount amount is worked out (spec 0014, Key invariants). Apply, the
// checkout prefill and Pay all call it, so the summary and the charge can never disagree.

export type DiscountType = "percent" | "fixed_amount";

export type DiscountTerms = {
  readonly type: DiscountType;
  // Percent 1 to 100, or an amount in minor units.
  readonly value: number;
};

// The limits a code carries; every one is optional.
export type DiscountCodeRules = DiscountTerms & {
  readonly active: boolean;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly maxRedemptions: number | null;
  readonly perCustomerLimit: number | null;
  readonly minSubtotalCents: number | null;
};

export type DiscountRefusal =
  "invalid" | "expired" | "used_up" | "below_minimum_subtotal" | "customer_limit" | "too_small";

// AC-2: the raw amount off the items subtotal. Percent rounds half up in integer math, so no
// float ever touches money.
export function discountCents(terms: DiscountTerms, subtotalCents: number): number {
  if (terms.type === "fixed_amount") return terms.value;
  return Math.floor((subtotalCents * terms.value + 50) / 100);
}

// AC-2, steps 1 to 3: the raw amount trimmed so the order never costs more than without the
// code and never falls below Stripe's minimum charge. Delivery is recomputed for each
// candidate, because a discount can take the items back under the free delivery threshold.
export function cappedDiscount(
  { raw, subtotalCents }: { readonly raw: number; readonly subtotalCents: number },
  settings: ShippingSettings,
  minimumCents: number,
): number {
  const total = (discount: number) =>
    orderCharges({ subtotalCents, discountCents: discount }, settings).totalCents;
  const fee = (discount: number) =>
    orderCharges({ subtotalCents, discountCents: discount }, settings).shippingCents;

  let discount = Math.max(0, Math.min(raw, subtotalCents));

  const threshold = settings.freeShippingThresholdCents;
  if (threshold !== null && subtotalCents >= threshold && subtotalCents - discount < threshold) {
    // Keeping the items at the threshold keeps delivery free; take whichever costs less, and on
    // a tie the larger discount.
    const atThreshold = subtotalCents - threshold;
    const cheaper = total(atThreshold) < total(discount);
    const tie = total(atThreshold) === total(discount);
    if (cheaper || (tie && atThreshold > discount)) discount = atThreshold;
  }

  if (total(discount) < minimumCents) {
    // The fee takes only two values, so one recompute settles it.
    let lowered = Math.max(0, subtotalCents + fee(discount) - minimumCents);
    if (fee(lowered) !== fee(discount)) {
      lowered = Math.max(0, subtotalCents + fee(lowered) - minimumCents);
    }
    discount = Math.min(discount, lowered);
  }
  return discount;
}

export type RefusalFacts = {
  // The database clock, so Apply and Pay judge dates by one clock.
  readonly now: Date;
  // Uses under the AC-3 rule: paid, or pending and under 35 minutes old.
  readonly uses: number;
  // Uses with this order email, or null when the email is not known yet (Apply only).
  readonly customerUses: number | null;
  readonly subtotalCents: number;
  // The amount after both caps.
  readonly discountCents: number;
};

// AC-3: the first reason that applies, in this order, or null when the code applies. A code
// that does not exist is null here too and reads as "invalid".
export function refusal(
  code: DiscountCodeRules | null,
  facts: RefusalFacts,
): DiscountRefusal | null {
  const now = facts.now.getTime();
  if (code === null || !code.active) return "invalid";
  if (code.startsAt !== null && code.startsAt.getTime() > now) return "invalid";
  if (code.endsAt !== null && code.endsAt.getTime() <= now) return "expired";
  if (code.maxRedemptions !== null && facts.uses >= code.maxRedemptions) return "used_up";
  if (code.minSubtotalCents !== null && facts.subtotalCents < code.minSubtotalCents) {
    return "below_minimum_subtotal";
  }
  if (
    code.perCustomerLimit !== null &&
    facts.customerUses !== null &&
    facts.customerUses >= code.perCustomerLimit
  ) {
    return "customer_limit";
  }
  if (facts.discountCents <= 0) return "too_small";
  return null;
}

export type DiscountEvaluation =
  | { readonly ok: true; readonly discountCents: number }
  | {
      readonly ok: false;
      readonly reason: DiscountRefusal;
      // Only for below_minimum_subtotal: how much more the items must come to.
      readonly minimumGapCents?: number;
    };

// AC-2 and AC-3 together, the one call Apply, the prefill and Pay make.
export function evaluateDiscount(input: {
  readonly code: DiscountCodeRules | null;
  readonly subtotalCents: number;
  readonly settings: ShippingSettings;
  readonly minimumCents: number;
  readonly now: Date;
  readonly uses: number;
  readonly customerUses: number | null;
}): DiscountEvaluation {
  const { code, subtotalCents } = input;
  const amount =
    code === null
      ? 0
      : cappedDiscount(
          { raw: discountCents(code, subtotalCents), subtotalCents },
          input.settings,
          input.minimumCents,
        );
  const reason = refusal(code, {
    now: input.now,
    uses: input.uses,
    customerUses: input.customerUses,
    subtotalCents,
    discountCents: amount,
  });
  if (reason === null) return { ok: true, discountCents: amount };
  if (reason === "below_minimum_subtotal" && code?.minSubtotalCents != null) {
    return { ok: false, reason, minimumGapCents: code.minSubtotalCents - subtotalCents };
  }
  return { ok: false, reason };
}

// AC-6: the order discount spread over the lines in proportion to each line's amount, each
// share rounded down, the leftover cents one each to the largest remainders (ties by line
// order). BigInt, because discount * line amount can pass 2^53.
export function splitDiscount(lineAmounts: readonly number[], discount: number): readonly number[] {
  const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  if (discount <= 0 || total <= 0) return lineAmounts.map(() => 0);
  if (discount > total) throw new Error(`Discount ${discount} is above the lines' ${total}`);

  const big = BigInt(total);
  const parts = lineAmounts.map((amount, index) => {
    const product = BigInt(discount) * BigInt(amount);
    return { index, share: Number(product / big), remainder: product % big };
  });
  let leftover = discount - parts.reduce((sum, part) => sum + part.share, 0);
  const byRemainder = parts.toSorted((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const shares = parts.map((part) => part.share);
  for (const part of byRemainder) {
    if (leftover === 0) break;
    shares[part.index] = (shares[part.index] ?? 0) + 1;
    leftover -= 1;
  }
  return shares;
}

export type CodeStatus = "inactive" | "used_up" | "expired" | "scheduled" | "active";

// AC-10 and State transitions: derived, never stored. The first that applies wins.
export function codeStatus(
  code: Pick<DiscountCodeRules, "active" | "startsAt" | "endsAt" | "maxRedemptions">,
  uses: number,
  now: Date,
): CodeStatus {
  if (!code.active) return "inactive";
  if (code.maxRedemptions !== null && uses >= code.maxRedemptions) return "used_up";
  if (code.endsAt !== null && code.endsAt.getTime() <= now.getTime()) return "expired";
  if (code.startsAt !== null && code.startsAt.getTime() > now.getTime()) return "scheduled";
  return "active";
}

export const codeStatusLabels: Readonly<Record<CodeStatus, string>> = {
  inactive: "Inactive",
  used_up: "Used up",
  expired: "Expired",
  scheduled: "Scheduled",
  active: "Active",
};

// "10%" or "€5.00 off" (AC-10 and AC-14).
export function discountLabel(terms: DiscountTerms, format: MoneyFormat): string {
  return terms.type === "percent" ? `${terms.value}%` : `${formatMoney(terms.value, format)} off`;
}

// AC-3: the exact words the customer sees.
export function refusalMessage(
  refused: { readonly reason: DiscountRefusal; readonly minimumGapCents?: number },
  format: MoneyFormat,
): string {
  switch (refused.reason) {
    case "invalid":
      return "This code isn't valid.";
    case "expired":
      return "This code has expired.";
    case "used_up":
      return "This code has been used up.";
    case "below_minimum_subtotal":
      return `Add ${formatMoney(refused.minimumGapCents ?? 0, format)} more to use this code.`;
    case "customer_limit":
      return "You've already used this code.";
    case "too_small":
      return "This order is too small for this code.";
  }
}

// AC-15: the customer's discount row, "Discount (SUMMER10)", or "Discount" for an order whose
// discount has no code text.
export function discountRowLabel(code: string | null): string {
  return code === null ? "Discount" : `Discount (${code})`;
}
