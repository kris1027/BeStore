import { describe, expect, it } from "vitest";

import { type SnapshotSource, snapshotOrder } from "./snapshot";

// spec 0006, AC-1 and Key invariants.

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
    const snapshot = snapshotOrder([
      source(),
      source({ variantId: "v2", sku: "B", unitPriceCents: 999, quantity: 3 }),
    ]);

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

  it("keeps sum(line totals) = subtotal - discount and total = subtotal - discount + shipping", () => {
    const snapshot = snapshotOrder([
      source({ unitPriceCents: 1, quantity: 10 }),
      source({ unitPriceCents: 12_345, quantity: 1 }),
      source({ unitPriceCents: 0, quantity: 4 }),
    ]);
    const lineSum = snapshot.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

    expect(lineSum).toBe(snapshot.subtotalCents - snapshot.discountCents);
    expect(snapshot.totalCents).toBe(
      snapshot.subtotalCents - snapshot.discountCents + snapshot.shippingCents,
    );
  });

  it("gives an empty cart a zero total", () => {
    expect(snapshotOrder([])).toMatchObject({ lines: [], subtotalCents: 0, totalCents: 0 });
  });
});
