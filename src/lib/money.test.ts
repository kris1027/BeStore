import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";

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
