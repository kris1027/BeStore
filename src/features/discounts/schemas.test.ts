import { describe, expect, it } from "vitest";

import {
  changedDiscountFields,
  changesLockedFields,
  discountCodeFieldsSchema,
  discountFieldErrors,
  emptyDiscountValues,
} from "./schemas";

// spec 0014, AC-11, AC-12, AC-18 and Validation messages.

const schema = discountCodeFieldsSchema("EUR", "Europe/Warsaw");
const valid = { ...emptyDiscountValues, code: "summer10", type: "percent" as const, value: "10" };

function errors(values: Record<string, unknown>) {
  const parsed = schema.safeParse({ ...valid, ...values });
  return parsed.success ? {} : discountFieldErrors(parsed.error);
}

describe("discountCodeFieldsSchema", () => {
  it("cleans a valid form into the row's values", () => {
    expect(
      schema.parse({
        ...valid,
        code: "  summer-10 ",
        startsAt: "2026-07-01T09:30",
        maxRedemptions: " 100 ",
        minSubtotal: "49.99",
        note: "  ",
      }),
    ).toEqual({
      code: "SUMMER-10",
      type: "percent",
      value: 10,
      startsAt: new Date("2026-07-01T07:30:00Z"),
      endsAt: null,
      maxRedemptions: 100,
      perCustomerLimit: null,
      minSubtotalCents: 4999,
      active: true,
      note: null,
    });
  });

  it("reads a fixed amount as money", () => {
    expect(schema.parse({ ...valid, type: "fixed_amount", value: "5.5" })).toMatchObject({
      type: "fixed_amount",
      value: 550,
    });
  });

  it.each([
    [{ code: "" }, { code: "Enter a code." }],
    [{ code: "ab" }, { code: "Use 3 to 32 letters, digits or hyphens." }],
    [{ code: "50% OFF" }, { code: "Use 3 to 32 letters, digits or hyphens." }],
    [{ type: "", value: "" }, { type: "Choose a type." }],
    [{ value: "0" }, { value: "Enter a whole percent from 1 to 100." }],
    [{ value: "10.5" }, { value: "Enter a whole percent from 1 to 100." }],
    [{ type: "fixed_amount", value: "0" }, { value: "Enter an amount above 0." }],
    [{ type: "fixed_amount", value: "1.234" }, { value: "Enter an amount above 0." }],
    [{ startsAt: "2026-02-30T10:00" }, { startsAt: "Enter a valid date and time." }],
    [
      { startsAt: "2026-07-02T10:00", endsAt: "2026-07-01T10:00" },
      { endsAt: "The end must be after the start." },
    ],
    [
      { maxRedemptions: "-1" },
      { maxRedemptions: "Enter a whole number above 0, or leave it empty." },
    ],
    [
      { perCustomerLimit: "0" },
      { perCustomerLimit: "Enter a whole number above 0, or leave it empty." },
    ],
    [{ minSubtotal: "0.00" }, { minSubtotal: "Enter an amount above 0, or leave it empty." }],
    [{ note: "n".repeat(501) }, { note: "Keep the note under 500 characters." }],
  ])("refuses %j", (values, expected) => {
    expect(errors(values)).toEqual(expected);
  });

  it("gives a crafted request with a field missing that field's message", () => {
    const parsed = schema.safeParse({ ...valid, note: undefined });
    expect(parsed.success ? {} : discountFieldErrors(parsed.error)).toEqual({
      note: "Keep the note under 500 characters.",
    });
  });
});

describe("changedDiscountFields and changesLockedFields", () => {
  const row = schema.parse({ ...valid, endsAt: "2026-12-01T10:00" });

  it("names the fields that differ, dates by instant", () => {
    expect(changedDiscountFields(row, { ...row, endsAt: new Date(row.endsAt!.getTime()) })).toEqual(
      [],
    );
    expect(changedDiscountFields(row, { ...row, active: false, note: "x" })).toEqual([
      "active",
      "note",
    ]);
  });

  it("flags only a change to the code, type or value", () => {
    expect(changesLockedFields(row, { ...row, maxRedemptions: 1 })).toBe(false);
    expect(changesLockedFields(row, { ...row, code: "OTHER" })).toBe(true);
    expect(changesLockedFields(row, { ...row, type: "fixed_amount" })).toBe(true);
    expect(changesLockedFields(row, { ...row, value: 11 })).toBe(true);
  });
});
