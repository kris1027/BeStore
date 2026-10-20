import { describe, expect, it } from "vitest";

import { shippingValues } from "./shipping-values";

// spec 0017, AC-5.
describe("shippingValues", () => {
  const format = { currency: "EUR", locale: "en" };

  it("names the fee and the threshold when one is set", () => {
    expect(
      shippingValues({ flatShippingCents: 999, freeShippingThresholdCents: 5000 }, format),
    ).toEqual({
      deliveryFee: "€9.99",
      freeDeliveryRule: "Delivery is free on orders of €50.00 or more.",
    });
  });

  it("says the same fee applies to every order without a threshold", () => {
    expect(
      shippingValues({ flatShippingCents: 450, freeShippingThresholdCents: null }, format),
    ).toEqual({ deliveryFee: "€4.50", freeDeliveryRule: "The same fee applies to every order." });
  });

  it("formats in the store currency and locale", () => {
    const values = shippingValues(
      { flatShippingCents: 1299, freeShippingThresholdCents: null },
      { currency: "PLN", locale: "pl-PL" },
    );
    expect(values.deliveryFee.replace(/\s/g, " ")).toBe("12,99 zł");
  });
});
