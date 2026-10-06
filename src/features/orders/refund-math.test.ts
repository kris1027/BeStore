import { describe, expect, it } from "vitest";

import {
  allocateReturns,
  cancelPlan,
  lineRefundCents,
  type RefundLedger,
  type MathRefund,
  refundableUnits,
  refundRequestErrors,
  refundState,
  remainingCents,
  reservedCents,
  shippingRefundable,
  suggestedCents,
} from "./refund-math";

// spec 0010, Refund math, AC-9, AC-11, AC-13 and AC-14.

const lineA = { id: "a", quantity: 3, lineTotalCents: 1000 };
const lineB = { id: "b", quantity: 1, lineTotalCents: 2500 };

function order(refunds: readonly MathRefund[] = [], shippingCents = 500): RefundLedger {
  return { totalCents: 3500 + shippingCents, shippingCents, lines: [lineA, lineB], refunds };
}

function refund(overrides: Partial<MathRefund> = {}): MathRefund {
  return {
    status: "succeeded",
    amountCents: 100,
    includesShipping: false,
    lines: [],
    ...overrides,
  };
}

describe("lineRefundCents", () => {
  it("adds up to exactly the line total over single unit refunds", () => {
    const parts = [0, 1, 2].map((done) => lineRefundCents(1000, 3, done, 1));
    expect(parts).toEqual([333, 333, 334]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(1000);
  });

  it("gives the whole line in one go", () => {
    expect(lineRefundCents(1000, 3, 0, 3)).toBe(1000);
  });
});

describe("reserved and remaining", () => {
  it("counts pending and succeeded refunds, never failed ones", () => {
    const refunds = [
      refund({ amountCents: 300 }),
      refund({ status: "pending", amountCents: 200 }),
      refund({ status: "failed", amountCents: 1000 }),
    ];
    expect(reservedCents(refunds)).toBe(500);
    expect(remainingCents(order(refunds))).toBe(3500);
  });

  it("never goes below 0", () => {
    expect(remainingCents(order([refund({ amountCents: 9999 })]))).toBe(0);
  });
});

describe("refundableUnits", () => {
  it("subtracts units of refunds that did not fail", () => {
    const math = order([
      refund({ lines: [{ orderLineId: "a", quantity: 1 }] }),
      refund({ status: "pending", lines: [{ orderLineId: "a", quantity: 1 }] }),
      refund({ status: "failed", lines: [{ orderLineId: "a", quantity: 1 }] }),
    ]);
    expect(refundableUnits(math, lineA)).toBe(1);
    expect(refundableUnits(math, lineB)).toBe(1);
  });
});

describe("shippingRefundable", () => {
  it("is offered until a refund that did not fail included it", () => {
    expect(shippingRefundable(order())).toBe(true);
    expect(shippingRefundable(order([refund({ includesShipping: true, status: "failed" })]))).toBe(
      true,
    );
    expect(shippingRefundable(order([refund({ includesShipping: true })]))).toBe(false);
    expect(shippingRefundable(order([], 0))).toBe(false);
  });
});

describe("suggestedCents", () => {
  it("prices chosen units and delivery, capped at what is left", () => {
    expect(suggestedCents(order(), [{ orderLineId: "a", quantity: 1 }], false)).toBe(333);
    expect(suggestedCents(order(), [{ orderLineId: "b", quantity: 1 }], true)).toBe(3000);
    const nearlyDone = order([refund({ amountCents: 3800 })]);
    expect(suggestedCents(nearlyDone, [{ orderLineId: "b", quantity: 1 }], false)).toBe(200);
  });

  it("refunding every unit and delivery suggests exactly the total", () => {
    const math = order();
    expect(
      suggestedCents(
        math,
        [
          { orderLineId: "a", quantity: 3 },
          { orderLineId: "b", quantity: 1 },
        ],
        true,
      ),
    ).toBe(math.totalCents);
  });

  it("continues where earlier refunds stopped", () => {
    const math = order([refund({ lines: [{ orderLineId: "a", quantity: 2 }] })]);
    expect(suggestedCents(math, [{ orderLineId: "a", quantity: 1 }], false)).toBe(334);
  });
});

describe("refundRequestErrors", () => {
  it("accepts a request within the caps", () => {
    expect(
      refundRequestErrors(order(), {
        lines: [{ orderLineId: "a", quantity: 1 }],
        refundShipping: false,
        amountCents: 300,
      }),
    ).toBeNull();
  });

  it("refuses more than the chosen items are worth", () => {
    expect(
      refundRequestErrors(order(), {
        lines: [{ orderLineId: "a", quantity: 1 }],
        refundShipping: false,
        amountCents: 334,
      }),
    ).toEqual({ amount: ["This is more than the chosen items and delivery are worth."] });
  });

  it("allows a goodwill refund up to what is left, and no more", () => {
    const math = order([refund({ amountCents: 3000 })]);
    const goodwill = { lines: [], refundShipping: false };
    expect(refundRequestErrors(math, { ...goodwill, amountCents: 1000 })).toBeNull();
    expect(refundRequestErrors(math, { ...goodwill, amountCents: 1001 })).toEqual({
      amount: ["This is more than is left to refund."],
    });
  });

  it("refuses below 1 cent, too many units, unknown lines and delivery twice", () => {
    const math = order([
      refund({ includesShipping: true, lines: [{ orderLineId: "b", quantity: 1 }] }),
    ]);
    expect(
      refundRequestErrors(math, {
        lines: [
          { orderLineId: "a", quantity: 4 },
          { orderLineId: "b", quantity: 1 },
          { orderLineId: "zzz", quantity: 1 },
        ],
        refundShipping: true,
        amountCents: 0,
      }),
    ).toEqual({
      "lines.a": ["At most 3 can still be refunded."],
      "lines.b": ["Every unit of this item is already refunded."],
      "lines.zzz": ["This item is not on the order."],
      refundShipping: ["Delivery is already refunded."],
      amount: ["Enter an amount above 0."],
    });
  });
});

describe("cancelPlan", () => {
  it("refunds everything left, every refundable unit, restock on the ticked lines", () => {
    const math = order([refund({ amountCents: 1000 })]);
    expect(cancelPlan(math, ["b"])).toEqual({
      amountCents: 3000,
      includesShipping: true,
      lines: [
        { orderLineId: "a", quantity: 3, restock: false },
        { orderLineId: "b", quantity: 1, restock: true },
      ],
    });
  });

  it("leaves out lines and delivery already refunded", () => {
    const math = order([
      refund({
        amountCents: 3000,
        includesShipping: true,
        lines: [{ orderLineId: "b", quantity: 1 }],
      }),
    ]);
    expect(cancelPlan(math, ["a", "b"])).toEqual({
      amountCents: 1000,
      includesShipping: false,
      lines: [{ orderLineId: "a", quantity: 3, restock: true }],
    });
  });
});

describe("allocateReturns", () => {
  it("hands out what is available lowest line id first", () => {
    expect(
      allocateReturns(3, [
        { id: "b", quantity: 2 },
        { id: "a", quantity: 2 },
      ]),
    ).toEqual([
      { id: "a", returned: 2 },
      { id: "b", returned: 1 },
    ]);
  });

  it("returns nothing when the sale took nothing (a shortfall or an older order)", () => {
    expect(allocateReturns(0, [{ id: "a", quantity: 2 }])).toEqual([{ id: "a", returned: 0 }]);
    expect(allocateReturns(-1, [{ id: "a", quantity: 2 }])).toEqual([{ id: "a", returned: 0 }]);
  });
});

describe("refundState", () => {
  it("is none, partial or full from refunded against total", () => {
    expect(refundState(1000, 0)).toBe("none");
    expect(refundState(1000, 1)).toBe("partial");
    expect(refundState(1000, 1000)).toBe("full");
  });
});
