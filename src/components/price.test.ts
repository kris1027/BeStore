import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Price } from "./price";
import { StoreFormatProvider } from "./store-format-provider";

// Intl separates the amount and the symbol with a narrow no break space in some locales.
const normalize = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

type FormatProps = Parameters<typeof StoreFormatProvider>[0];

// createElement's types want children in props, the lint wants them as an argument.
function render(price: Parameters<typeof Price>[0], store = { locale: "en", currency: "EUR" }) {
  return normalize(
    renderToStaticMarkup(
      createElement(StoreFormatProvider, store as FormatProps, createElement(Price, price)),
    ),
  );
}

describe("Price", () => {
  // covers: AC-10
  it("formats in the store's currency and locale by default", () => {
    expect(render({ cents: 1999 })).toContain(">€19.99<");
  });

  it("follows the store locale from the provider", () => {
    expect(render({ cents: 1999 }, { locale: "pl-PL", currency: "PLN" })).toContain(">19,99 zł<");
  });

  // covers: AC-10 (orders keep their own currency)
  it("uses an explicit currency over the store's", () => {
    expect(render({ cents: 1999, currency: "JPY" })).toContain(">¥1,999<");
  });

  it("throws when rendered outside StoreFormatProvider", () => {
    expect(() => renderToStaticMarkup(createElement(Price, { cents: 1999 }))).toThrow(
      "StoreFormatProvider",
    );
  });

  it("throws on a price that is not integer minor units", () => {
    expect(() => render({ cents: 19.99 })).toThrow("integer minor units");
  });
});
