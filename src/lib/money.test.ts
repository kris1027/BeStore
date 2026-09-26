import { describe, expect, it } from "vitest";

import { formatMoney, parseMoney } from "./money";

// Intl separates the amount and the symbol with a narrow no break space in some locales.
const normalize = (value: string) => value.replace(/[  ]/g, " ");

describe("formatMoney", () => {
  it.each([
    [1999, "EUR", "en", "€19.99"],
    [1999, "JPY", "en", "¥1,999"],
    [-500, "EUR", "en", "-€5.00"],
    [0, "EUR", "en", "€0.00"],
    [123456789, "USD", "en", "$1,234,567.89"],
    [1999, "EUR", "pl-PL", "19,99 €"],
    [1999, "PLN", "pl-PL", "19,99 zł"],
    [1999, "JPY", "pl-PL", "1999 JPY"],
    [1999, "KWD", "en", "KWD 1.999"],
  ])("formats %i %s in %s as %s", (cents, currency, locale, expected) => {
    expect(normalize(formatMoney(cents, { currency, locale }))).toBe(expected);
  });

  it.each([19.99, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws on %d, which is not integer minor units",
    (cents) => {
      expect(() => formatMoney(cents, { currency: "EUR", locale: "en" })).toThrow(
        "integer minor units",
      );
    },
  );
});

describe("parseMoney", () => {
  it.each([
    ["19.99", "EUR", 1999],
    ["19.9", "EUR", 1990],
    ["19", "EUR", 1900],
    [" 0.01 ", "EUR", 1],
    ["007.50", "EUR", 750],
    ["1999", "JPY", 1999],
    ["1.999", "KWD", 1999],
    ["21474836.47", "EUR", 2_147_483_647],
  ])("reads %s %s as %i minor units", (text, currency, cents) => {
    expect(parseMoney(text, currency)).toEqual({ ok: true, cents });
  });

  it.each(["", "abc", "-1", "1,50", "1.", ".5", "1e3", "1.2.3", "€5"])(
    "refuses %j as malformed",
    (text) => {
      expect(parseMoney(text, "EUR")).toEqual({ ok: false, error: "format" });
    },
  );

  it("refuses more decimals than the currency has", () => {
    expect(parseMoney("19.999", "EUR")).toEqual({ ok: false, error: "decimals" });
    expect(parseMoney("5.5", "JPY")).toEqual({ ok: false, error: "decimals" });
  });

  it("refuses an amount that does not fit an integer column", () => {
    expect(parseMoney("21474836.48", "EUR")).toEqual({ ok: false, error: "too_large" });
    expect(parseMoney("99999999999999999999", "EUR")).toEqual({ ok: false, error: "too_large" });
  });
});
