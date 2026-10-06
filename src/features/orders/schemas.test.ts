import { describe, expect, it } from "vitest";

import {
  cancelSchema,
  noteSchema,
  pathErrors,
  reasonSchema,
  refundSchema,
  trackingSchema,
} from "./schemas";

// spec 0010, API surface: the inputs every admin order action accepts (AC-4, AC-6, AC-7, AC-8,
// AC-9, AC-19).

const ref = { orderNumber: 1001, expectedUpdatedAt: "2026-10-05T10:00:00.000Z" };
const LINE_ID = "3f0c8a52-6d0e-4c9a-9a51-2f1f0e6b7c11";

const errorsOf = (result: { success: boolean; error?: Parameters<typeof pathErrors>[0] }) =>
  result.error ? pathErrors(result.error) : null;

describe("trackingSchema", () => {
  it("trims carrier and tracking", () => {
    const parsed = trackingSchema.parse({ ...ref, carrier: "  DHL ", trackingNumber: " X1 " });
    expect(parsed).toMatchObject({ carrier: "DHL", trackingNumber: "X1" });
  });

  it("saves an empty or blank field as null", () => {
    const parsed = trackingSchema.parse({ ...ref, carrier: "", trackingNumber: "   " });
    expect(parsed).toMatchObject({ carrier: null, trackingNumber: null });
  });

  it("refuses a field over 100 characters, naming the field", () => {
    const result = trackingSchema.safeParse({
      ...ref,
      carrier: "c".repeat(101),
      trackingNumber: "",
    });
    expect(errorsOf(result)).toEqual({
      carrier: ["Keep the carrier under 100 characters."],
    });
  });

  it("accepts exactly 100 characters", () => {
    expect(
      trackingSchema.safeParse({ ...ref, carrier: "", trackingNumber: "t".repeat(100) }).success,
    ).toBe(true);
  });
});

describe("the order reference (AC-8)", () => {
  it.each([1000, 0, -1, 1001.5, 2_147_483_648])("refuses order number %j", (orderNumber) => {
    expect(reasonSchema.safeParse({ ...ref, orderNumber, reason: "x" }).success).toBe(false);
  });

  it("needs the updated_at the page was rendered with, as an ISO date time", () => {
    expect(
      reasonSchema.safeParse({ ...ref, expectedUpdatedAt: "yesterday", reason: "x" }).success,
    ).toBe(false);
    expect(reasonSchema.safeParse({ orderNumber: 1001, reason: "x" } as unknown).success).toBe(
      false,
    );
  });
});

describe("reasons and notes (AC-6, AC-19)", () => {
  it("needs a reason that is not only spaces", () => {
    expect(errorsOf(reasonSchema.safeParse({ ...ref, reason: "   " }))).toEqual({
      reason: ["Give a reason."],
    });
  });

  it("trims the reason and caps it at 500 characters", () => {
    expect(reasonSchema.parse({ ...ref, reason: "  late  " }).reason).toBe("late");
    expect(reasonSchema.safeParse({ ...ref, reason: "r".repeat(500) }).success).toBe(true);
    expect(errorsOf(reasonSchema.safeParse({ ...ref, reason: "r".repeat(501) }))).toEqual({
      reason: ["Keep the reason under 500 characters."],
    });
  });

  it("takes a note without updated_at, so a note never goes stale", () => {
    expect(noteSchema.parse({ orderNumber: 1001, note: " Called the customer " })).toEqual({
      orderNumber: 1001,
      note: "Called the customer",
    });
  });

  it("refuses an empty note and one over 1000 characters", () => {
    expect(errorsOf(noteSchema.safeParse({ orderNumber: 1001, note: "" }))).toEqual({
      note: ["Write a note."],
    });
    expect(errorsOf(noteSchema.safeParse({ orderNumber: 1001, note: "n".repeat(1001) }))).toEqual({
      note: ["Keep the note under 1000 characters."],
    });
  });
});

describe("refundSchema (AC-9)", () => {
  const valid = {
    ...ref,
    lines: [{ orderLineId: LINE_ID, quantity: 1, restock: true }],
    refundShipping: false,
    amount: " 12.50 ",
    reason: "Returned",
  };

  it("keeps the typed amount as trimmed text for parseMoney to read", () => {
    expect(refundSchema.parse(valid).amount).toBe("12.50");
  });

  it("accepts a goodwill refund with no lines", () => {
    expect(refundSchema.safeParse({ ...valid, lines: [] }).success).toBe(true);
  });

  it("refuses a line id that is not a uuid and a quantity below 1", () => {
    const result = refundSchema.safeParse({
      ...valid,
      lines: [{ orderLineId: "line-1", quantity: 0, restock: false }],
    });
    expect(Object.keys(errorsOf(result) ?? {})).toEqual(
      expect.arrayContaining(["lines.0.orderLineId", "lines.0.quantity"]),
    );
  });

  it("refuses a fractional quantity", () => {
    expect(
      refundSchema.safeParse({
        ...valid,
        lines: [{ orderLineId: LINE_ID, quantity: 1.5, restock: false }],
      }).success,
    ).toBe(false);
  });
});

describe("cancelSchema (AC-14)", () => {
  it("needs a reason and takes the lines to restock by id", () => {
    expect(
      cancelSchema.parse({ ...ref, reason: "Out of stock", restockLineIds: [LINE_ID] }),
    ).toMatchObject({ restockLineIds: [LINE_ID] });
    expect(errorsOf(cancelSchema.safeParse({ ...ref, reason: "", restockLineIds: [] }))).toEqual({
      reason: ["Give a reason."],
    });
  });
});

describe("pathErrors", () => {
  it("joins nested paths with dots and puts path less issues under root", () => {
    const nested = refundSchema.safeParse({
      ...ref,
      lines: [{ orderLineId: LINE_ID, quantity: 0, restock: true }],
      refundShipping: false,
      amount: "1",
      reason: "x",
    });
    expect(errorsOf(nested)).toEqual({
      "lines.0.quantity": [expect.any(String)],
    });

    const root = reasonSchema.safeParse("not an object");
    expect(Object.keys(errorsOf(root) ?? {})).toEqual(["root"]);
  });
});
