import { describe, expect, it } from "vitest";

import { shippingSettingsFieldErrors, shippingSettingsSchema } from "./schemas";

// spec 0007, AC-10 and Validation messages.

const schema = shippingSettingsSchema("EUR");

function errorsFor(input: Record<string, unknown>) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected the input to be refused");
  return shippingSettingsFieldErrors(result.error);
}

describe("shippingSettingsSchema", () => {
  it("turns the fee and threshold into cents", () => {
    expect(
      schema.parse({ deliveryFee: "12.00", freeDelivery: true, freeDeliveryFrom: "200" }),
    ).toEqual({ flatShippingCents: 1200, freeShippingThresholdCents: 20_000 });
  });

  // covers: AC-10, Value sourcing `updateShippingSettings` cents.
  it("pads a single decimal, so 12.5 is 1250 cents", () => {
    expect(
      schema.parse({ deliveryFee: "12.5", freeDelivery: true, freeDeliveryFrom: "0.5" }),
    ).toEqual({ flatShippingCents: 1250, freeShippingThresholdCents: 50 });
  });

  it("stores no threshold when free delivery is off, whatever the field holds", () => {
    expect(
      schema.parse({ deliveryFee: "9.99", freeDelivery: false, freeDeliveryFrom: "nonsense" }),
    ).toEqual({ flatShippingCents: 999, freeShippingThresholdCents: null });
    expect(schema.parse({ deliveryFee: "0", freeDelivery: false })).toEqual({
      flatShippingCents: 0,
      freeShippingThresholdCents: null,
    });
  });

  it.each(["1000", "1000.00", "0.00"])("accepts the fee %j at the edges", (deliveryFee) => {
    expect(schema.safeParse({ deliveryFee, freeDelivery: false }).success).toBe(true);
  });

  it.each([
    ["", "Enter an amount like 9.99."],
    ["9,99", "Enter an amount like 9.99."],
    ["-1", "Enter an amount like 9.99."],
    ["9.999", "Enter an amount like 9.99."],
    ["1000.01", "Delivery fee can be at most 1,000.00."],
    ["99999999999", "Delivery fee can be at most 1,000.00."],
  ])("refuses the fee %j with %j", (deliveryFee, message) => {
    expect(errorsFor({ deliveryFee, freeDelivery: false })).toEqual({ deliveryFee: message });
  });

  it.each(["0.01", "100000", "100000.00"])("accepts the threshold %j", (freeDeliveryFrom) => {
    expect(
      schema.safeParse({ deliveryFee: "10", freeDelivery: true, freeDeliveryFrom }).success,
    ).toBe(true);
  });

  it.each([
    ["", "Enter an amount like 9.99."],
    [undefined, "Enter an amount like 9.99."],
    ["0", "Enter an amount above 0."],
    ["0.00", "Enter an amount above 0."],
    ["100000.01", "Free delivery threshold can be at most 100,000.00."],
  ])("refuses the threshold %j with %j", (freeDeliveryFrom, message) => {
    expect(errorsFor({ deliveryFee: "10", freeDelivery: true, freeDeliveryFrom })).toEqual({
      freeDeliveryFrom: message,
    });
  });

  // A crafted call can omit a field or send another type; it still gets the field's own message.
  it.each([undefined, 12])("refuses a fee of %j with the format message", (deliveryFee) => {
    expect(errorsFor({ deliveryFee, freeDelivery: true, freeDeliveryFrom: 12 })).toEqual({
      deliveryFee: "Enter an amount like 9.99.",
      freeDeliveryFrom: "Enter an amount like 9.99.",
    });
  });

  it.each([undefined, "true", 1])("refuses a free delivery choice of %j", (freeDelivery) => {
    expect(errorsFor({ deliveryFee: "10", freeDelivery })).toEqual({
      freeDelivery: "Choose whether to offer free delivery.",
    });
  });

  it("names both fields at once", () => {
    expect(errorsFor({ deliveryFee: "x", freeDelivery: true, freeDeliveryFrom: "0" })).toEqual({
      deliveryFee: "Enter an amount like 9.99.",
      freeDeliveryFrom: "Enter an amount above 0.",
    });
  });

  it("formats the maximums with the currency's own decimals", () => {
    const yen = shippingSettingsSchema("JPY");
    const result = yen.safeParse({ deliveryFee: "1001", freeDelivery: false });

    expect(result.error?.issues[0]?.message).toBe("Delivery fee can be at most 1,000.");
    expect(yen.parse({ deliveryFee: "1000", freeDelivery: false }).flatShippingCents).toBe(1000);
  });
});
