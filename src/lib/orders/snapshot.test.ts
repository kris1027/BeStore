import { describe, expect, it } from "vitest";

import type { ShippingSettings } from "@/lib/shipping/rule";

import { type SnapshotSource, snapshotOrder } from "./snapshot";

// spec 0006, AC-1 and Key invariants; spec 0007, AC-3 and AC-5; spec 0014, AC-2 and AC-6.

const freeDelivery: ShippingSettings = { flatShippingCents: 0, freeShippingThresholdCents: null };

function source(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    variantId: "v1",
    productId: "p1",
    productName: "Tee",
    variantLabel: "M / Navy",
    sku: "TEE-M-NAVY",
    imagePath: null,
    unitPriceCents: 2500,
    quantity: 2,
    ...overrides,
  };
}

describe("snapshotOrder", () => {
  it("copies each line and prices it from its own unit price", () => {
    const snapshot = snapshotOrder(
      [source(), source({ variantId: "v2", sku: "B", unitPriceCents: 999, quantity: 3 })],
      freeDelivery,
      null,
    );

    expect(snapshot.lines).toEqual([
      { ...source(), discountCents: 0, lineTotalCents: 5000 },
      expect.objectContaining({ sku: "B", discountCents: 0, lineTotalCents: 2997 }),
    ]);
    expect(snapshot).toMatchObject({
      subtotalCents: 7997,
      discountCents: 0,
      shippingCents: 0,
      totalCents: 7997,
    });
  });

  it("adds the flat fee below the threshold and nothing at it", () => {
    const settings = { flatShippingCents: 1500, freeShippingThresholdCents: 5000 };

    expect(snapshotOrder([source({ quantity: 1 })], settings, null)).toMatchObject({
      subtotalCents: 2500,
      shippingCents: 1500,
      totalCents: 4000,
    });
    expect(snapshotOrder([source()], settings, null)).toMatchObject({
      subtotalCents: 5000,
      shippingCents: 0,
      totalCents: 5000,
    });
  });

  it("keeps sum(line totals) = subtotal - discount and total = subtotal - discount + shipping", () => {
    const snapshot = snapshotOrder(
      [
        source({ unitPriceCents: 1, quantity: 10 }),
        source({ unitPriceCents: 12_345, quantity: 1 }),
        source({ unitPriceCents: 0, quantity: 4 }),
      ],
      { flatShippingCents: 999, freeShippingThresholdCents: null },
      { discountCents: 1234 },
    );
    const lineSum = snapshot.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

    expect(lineSum).toBe(snapshot.subtotalCents - snapshot.discountCents);
    expect(snapshot.shippingCents).toBe(999);
    expect(snapshot.totalCents).toBe(
      snapshot.subtotalCents - snapshot.discountCents + snapshot.shippingCents,
    );
  });

  it("gives an empty cart a zero total when delivery is free", () => {
    expect(snapshotOrder([], freeDelivery, null)).toMatchObject({
      lines: [],
      subtotalCents: 0,
      totalCents: 0,
    });
  });

  it("splits a discount onto the lines and works delivery out on what is left", () => {
    const settings = { flatShippingCents: 1500, freeShippingThresholdCents: 5000 };
    const snapshot = snapshotOrder(
      [source({ unitPriceCents: 3000, quantity: 1 }), source({ variantId: "v2", sku: "B" })],
      settings,
      { discountCents: 1000 },
    );

    // 1000 over 3000 and 5000: 375 and 625.
    expect(snapshot.lines.map((line) => [line.discountCents, line.lineTotalCents])).toEqual([
      [375, 2625],
      [625, 4375],
    ]);
    expect(snapshot).toMatchObject({
      subtotalCents: 8000,
      discountCents: 1000,
      shippingCents: 0,
      totalCents: 7000,
    });
  });

  it("charges delivery again when the discount takes the items under the threshold", () => {
    const settings = { flatShippingCents: 1500, freeShippingThresholdCents: 5000 };

    expect(snapshotOrder([source()], settings, { discountCents: 500 })).toMatchObject({
      subtotalCents: 5000,
      discountCents: 500,
      shippingCents: 1500,
      totalCents: 6000,
    });
  });

  it("leaves only delivery on a fully discounted order", () => {
    const snapshot = snapshotOrder(
      [source()],
      { flatShippingCents: 999, freeShippingThresholdCents: null },
      { discountCents: 5000 },
    );

    expect(snapshot.lines[0]).toMatchObject({ discountCents: 5000, lineTotalCents: 0 });
    expect(snapshot.totalCents).toBe(999);
  });
});
