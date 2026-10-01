import { describe, expect, it } from "vitest";

import {
  deliveryLabel,
  freeDeliveryGapCents,
  orderCharges,
  type ShippingSettings,
  shippingCents,
} from "./rule";

// spec 0007, AC-3 and AC-8.

const withThreshold: ShippingSettings = {
  flatShippingCents: 1500,
  freeShippingThresholdCents: 20_000,
};

function basis(subtotalCents: number, discountCents = 0) {
  return { subtotalCents, discountCents };
}

describe("shippingCents", () => {
  it.each([
    [19_999, 1500],
    [20_000, 0],
    [20_001, 0],
  ])("charges subtotal %i the fee %i against a 200.00 threshold", (subtotal, fee) => {
    expect(shippingCents(basis(subtotal), withThreshold)).toBe(fee);
  });

  it("compares the subtotal after the discount", () => {
    expect(shippingCents(basis(20_500, 600), withThreshold)).toBe(1500);
    expect(shippingCents(basis(20_500, 500), withThreshold)).toBe(0);
  });

  it("always charges the flat fee when there is no threshold", () => {
    const settings = { flatShippingCents: 999, freeShippingThresholdCents: null };

    expect(shippingCents(basis(1_000_000), settings)).toBe(999);
  });

  it("is always free with a flat fee of 0", () => {
    const settings = { flatShippingCents: 0, freeShippingThresholdCents: null };

    expect(shippingCents(basis(1), settings)).toBe(0);
  });
});

describe("orderCharges", () => {
  it("adds the fee to the subtotal after the discount", () => {
    expect(orderCharges(basis(19_999, 500), withThreshold)).toEqual({
      shippingCents: 1500,
      totalCents: 20_999,
    });
  });

  it("adds nothing once delivery is free", () => {
    expect(orderCharges(basis(20_000), withThreshold)).toEqual({
      shippingCents: 0,
      totalCents: 20_000,
    });
  });
});

describe("freeDeliveryGapCents", () => {
  it("is the amount still missing below the threshold", () => {
    expect(freeDeliveryGapCents(basis(19_999), withThreshold)).toBe(1);
    expect(freeDeliveryGapCents(basis(5000, 1000), withThreshold)).toBe(16_000);
  });

  // covers: AC-8, Value sourcing `/cart` gap (threshold 200.00, subtotal 150.00).
  it("asks for 50.00 more on a 150.00 cart against a 200.00 threshold", () => {
    expect(freeDeliveryGapCents(basis(15_000), withThreshold)).toBe(5000);
  });

  it("is null once the threshold is reached", () => {
    expect(freeDeliveryGapCents(basis(20_000), withThreshold)).toBeNull();
  });

  it("is null without a threshold, or when delivery is free anyway", () => {
    expect(
      freeDeliveryGapCents(basis(100), {
        flatShippingCents: 1500,
        freeShippingThresholdCents: null,
      }),
    ).toBeNull();
    expect(
      freeDeliveryGapCents(basis(100), {
        flatShippingCents: 0,
        freeShippingThresholdCents: 20_000,
      }),
    ).toBeNull();
  });
});

describe("deliveryLabel", () => {
  it("names a charged and a free delivery", () => {
    expect(deliveryLabel(1500)).toBe("Standard delivery");
    expect(deliveryLabel(0)).toBe("Free delivery");
  });
});
