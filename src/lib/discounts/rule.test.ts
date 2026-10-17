import { describe, expect, it } from "vitest";

import type { ShippingSettings } from "@/lib/shipping/rule";

import {
  cappedDiscount,
  codeStatus,
  discountCents,
  type DiscountCodeRules,
  discountLabel,
  evaluateDiscount,
  refusal,
  type RefusalFacts,
  refusalMessage,
  refusedDiscount,
  splitDiscount,
} from "./rule";

// spec 0014, AC-2, AC-3, AC-6 and AC-10.

const eur = { currency: "EUR", locale: "en" };
const noDelivery: ShippingSettings = { flatShippingCents: 0, freeShippingThresholdCents: null };
const now = new Date("2026-10-17T12:00:00Z");

function code(overrides: Partial<DiscountCodeRules> = {}): DiscountCodeRules {
  return {
    type: "percent",
    value: 10,
    active: true,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    perCustomerLimit: null,
    minSubtotalCents: null,
    ...overrides,
  };
}

function facts(overrides: Partial<RefusalFacts> = {}): RefusalFacts {
  return {
    now,
    uses: 0,
    customerUses: 0,
    subtotalCents: 5000,
    discountCents: 500,
    ...overrides,
  };
}

describe("discountCents", () => {
  it("rounds a percent half up in integer math", () => {
    expect(discountCents({ type: "percent", value: 10 }, 1005)).toBe(101);
    expect(discountCents({ type: "percent", value: 10 }, 1004)).toBe(100);
    expect(discountCents({ type: "percent", value: 15 }, 999)).toBe(150);
    expect(discountCents({ type: "percent", value: 100 }, 4321)).toBe(4321);
  });

  it("takes a fixed amount as it is, whatever the subtotal", () => {
    expect(discountCents({ type: "fixed_amount", value: 700 }, 300)).toBe(700);
  });
});

describe("cappedDiscount", () => {
  it("never takes more than the items subtotal", () => {
    const settings = { flatShippingCents: 1500, freeShippingThresholdCents: null };

    expect(cappedDiscount({ raw: 5000, subtotalCents: 3000 }, settings, 50)).toBe(3000);
  });

  it("trims a code that would push the items under the free delivery threshold", () => {
    const settings = { flatShippingCents: 1500, freeShippingThresholdCents: 5000 };

    // 520 off 5200 would cost 4680 + 1500; keeping the items at 5000 costs 5000.
    expect(cappedDiscount({ raw: 520, subtotalCents: 5200 }, settings, 50)).toBe(200);
  });

  it("keeps the larger discount when both cost the same", () => {
    const settings = { flatShippingCents: 1500, freeShippingThresholdCents: 5000 };

    // 3000 off: 3500 + 1500 = 5000. 1500 off: 5000 + 0 = 5000.
    expect(cappedDiscount({ raw: 3000, subtotalCents: 6500 }, settings, 50)).toBe(3000);
  });

  it("keeps the whole discount when going under the threshold is still cheaper", () => {
    const settings = { flatShippingCents: 300, freeShippingThresholdCents: 5000 };

    // 2000 off: 3200 + 300 = 3500, below the 5000 that 200 off would cost.
    expect(cappedDiscount({ raw: 2000, subtotalCents: 5200 }, settings, 50)).toBe(2000);
  });

  it("lowers the discount to keep the total at Stripe's minimum", () => {
    expect(cappedDiscount({ raw: 5000, subtotalCents: 3000 }, noDelivery, 50)).toBe(2950);
  });

  it("recomputes the minimum cap once when the lowered discount changes delivery", () => {
    const settings = { flatShippingCents: 10, freeShippingThresholdCents: 20 };

    // 95 off leaves 5 + 10 = 15. Lowering to 60 frees delivery (40 >= 20, total 40), so the
    // second step lowers to 50: 50 + 0 = 50.
    expect(cappedDiscount({ raw: 95, subtotalCents: 100 }, settings, 50)).toBe(50);
  });

  it("can leave no discount at all", () => {
    expect(cappedDiscount({ raw: 10, subtotalCents: 50 }, noDelivery, 50)).toBe(0);
  });

  it("never makes the total higher than the same cart without a code", () => {
    const settings = { flatShippingCents: 1500, freeShippingThresholdCents: 5000 };
    for (let subtotal = 4000; subtotal <= 7000; subtotal += 137) {
      for (const raw of [1, 99, 500, 1200, 3000, 9000]) {
        const discount = cappedDiscount({ raw, subtotalCents: subtotal }, settings, 50);
        const fee = (items: number) => (items >= 5000 ? 0 : 1500);
        const withCode = subtotal - discount + fee(subtotal - discount);
        expect(withCode).toBeLessThanOrEqual(subtotal + fee(subtotal));
        expect(withCode).toBeGreaterThanOrEqual(50);
      }
    }
  });
});

describe("refusal", () => {
  it("passes a code with nothing against it", () => {
    expect(refusal(code(), facts())).toBeNull();
  });

  it("refuses a missing, inactive or not yet started code as invalid", () => {
    expect(refusal(null, facts())).toBe("invalid");
    expect(refusal(code({ active: false }), facts())).toBe("invalid");
    expect(refusal(code({ startsAt: new Date("2026-10-17T12:00:01Z") }), facts())).toBe("invalid");
  });

  it("counts the start as inclusive and the end as exclusive", () => {
    expect(refusal(code({ startsAt: now }), facts())).toBeNull();
    expect(refusal(code({ endsAt: now }), facts())).toBe("expired");
    expect(refusal(code({ endsAt: new Date("2026-10-17T12:00:01Z") }), facts())).toBeNull();
  });

  it("refuses at the total use limit", () => {
    expect(refusal(code({ maxRedemptions: 3 }), facts({ uses: 2 }))).toBeNull();
    expect(refusal(code({ maxRedemptions: 3 }), facts({ uses: 3 }))).toBe("used_up");
  });

  it("refuses below the minimum subtotal", () => {
    expect(refusal(code({ minSubtotalCents: 5000 }), facts())).toBeNull();
    expect(refusal(code({ minSubtotalCents: 5001 }), facts())).toBe("below_minimum_subtotal");
  });

  it("refuses at the per customer limit, and skips it while the email is unknown", () => {
    expect(refusal(code({ perCustomerLimit: 1 }), facts({ customerUses: 1 }))).toBe(
      "customer_limit",
    );
    expect(refusal(code({ perCustomerLimit: 1 }), facts({ customerUses: null }))).toBeNull();
  });

  it("refuses a code the caps leave at 0", () => {
    expect(refusal(code(), facts({ discountCents: 0 }))).toBe("too_small");
  });

  it("answers the first reason that applies", () => {
    const everything = code({
      active: true,
      endsAt: now,
      maxRedemptions: 1,
      minSubtotalCents: 9999,
      perCustomerLimit: 1,
    });
    const all = facts({ uses: 1, customerUses: 1, discountCents: 0 });

    expect(refusal({ ...everything, active: false }, all)).toBe("invalid");
    expect(refusal(everything, all)).toBe("expired");
    expect(refusal({ ...everything, endsAt: null }, all)).toBe("used_up");
    expect(refusal({ ...everything, endsAt: null, maxRedemptions: null }, all)).toBe(
      "below_minimum_subtotal",
    );
    expect(
      refusal({ ...everything, endsAt: null, maxRedemptions: null, minSubtotalCents: null }, all),
    ).toBe("customer_limit");
    expect(
      refusal(
        {
          ...everything,
          endsAt: null,
          maxRedemptions: null,
          minSubtotalCents: null,
          perCustomerLimit: null,
        },
        all,
      ),
    ).toBe("too_small");
  });
});

describe("evaluateDiscount", () => {
  const base = {
    subtotalCents: 5000,
    settings: noDelivery,
    minimumCents: 50,
    now,
    uses: 0,
    customerUses: 0,
  };

  it("answers the capped amount for a code that applies", () => {
    expect(evaluateDiscount({ ...base, code: code({ value: 15 }) })).toEqual({
      ok: true,
      discountCents: 750,
    });
  });

  it("carries how much more the items must come to", () => {
    expect(evaluateDiscount({ ...base, code: code({ minSubtotalCents: 6250 }) })).toEqual({
      ok: false,
      reason: "below_minimum_subtotal",
      minimumGapCents: 1250,
    });
  });

  it("refuses a code the minimum charge leaves at 0", () => {
    expect(
      evaluateDiscount({ ...base, subtotalCents: 50, code: code({ type: "fixed_amount" }) }),
    ).toEqual({ ok: false, reason: "too_small" });
  });
});

describe("refusedDiscount", () => {
  it("keeps the reason and the gap, and drops everything else", () => {
    const evaluation = {
      ok: false,
      reason: "below_minimum_subtotal",
      minimumGapCents: 1250,
    } as const;
    expect(refusedDiscount(evaluation)).toStrictEqual({
      reason: "below_minimum_subtotal",
      minimumGapCents: 1250,
    });
  });

  it("leaves out the gap key when there is none", () => {
    const evaluation = { ok: false, reason: "expired" } as const;
    expect(refusedDiscount(evaluation)).toStrictEqual({ reason: "expired" });
  });
});

describe("splitDiscount", () => {
  it("splits in proportion to each line", () => {
    expect(splitDiscount([3000, 5000], 1000)).toEqual([375, 625]);
  });

  it("gives the leftover cents to the largest remainders, ties by line order", () => {
    expect(splitDiscount([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(splitDiscount([1, 1, 1], 2)).toEqual([1, 1, 0]);
    // 10 over 3, 3, 4: shares 3, 3, 4 exactly.
    expect(splitDiscount([3, 3, 4], 10)).toEqual([3, 3, 4]);
    // 7 over 10 and 20: 2.33 and 4.67, the larger remainder takes the cent.
    expect(splitDiscount([10, 20], 7)).toEqual([2, 5]);
  });

  it("always sums to the discount and never passes a line", () => {
    const lines = [2_000_000_000, 147_483_647, 1, 0, 999];
    for (const discount of [1, 7, 1_000_000, 2_147_484_647]) {
      const shares = splitDiscount(lines, discount);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(discount);
      shares.forEach((share, index) => expect(share).toBeLessThanOrEqual(lines[index] ?? 0));
    }
  });

  it("splits nothing when there is no discount", () => {
    expect(splitDiscount([100, 200], 0)).toEqual([0, 0]);
    expect(splitDiscount([], 0)).toEqual([]);
  });

  it("throws on a discount above the lines, a broken caller", () => {
    expect(() => splitDiscount([100], 101)).toThrow();
  });
});

describe("codeStatus", () => {
  it("answers the first status that applies", () => {
    const scheduled = { startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: now };

    expect(codeStatus({ ...code(), active: false, ...scheduled, maxRedemptions: 1 }, 1, now)).toBe(
      "inactive",
    );
    expect(codeStatus({ ...code(), ...scheduled, maxRedemptions: 1 }, 1, now)).toBe("used_up");
    expect(codeStatus({ ...code(), ...scheduled, maxRedemptions: 2 }, 1, now)).toBe("expired");
    expect(codeStatus({ ...code(), startsAt: scheduled.startsAt }, 0, now)).toBe("scheduled");
    expect(codeStatus(code(), 0, now)).toBe("active");
  });
});

describe("labels", () => {
  it("shows a percent or an amount off", () => {
    expect(discountLabel({ type: "percent", value: 10 }, eur)).toBe("10%");
    expect(discountLabel({ type: "fixed_amount", value: 500 }, eur)).toBe("€5.00 off");
  });

  it("words every refusal", () => {
    expect(refusalMessage({ reason: "invalid" }, eur)).toBe("This code isn't valid.");
    expect(refusalMessage({ reason: "expired" }, eur)).toBe("This code has expired.");
    expect(refusalMessage({ reason: "used_up" }, eur)).toBe("This code has been used up.");
    expect(refusalMessage({ reason: "below_minimum_subtotal", minimumGapCents: 1250 }, eur)).toBe(
      "Add €12.50 more to use this code.",
    );
    expect(refusalMessage({ reason: "customer_limit" }, eur)).toBe(
      "You've already used this code.",
    );
    expect(refusalMessage({ reason: "too_small" }, eur)).toBe(
      "This order is too small for this code.",
    );
  });
});
