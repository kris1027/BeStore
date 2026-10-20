import { describe, expect, it } from "vitest";

import { OrderConfirmationEmail } from "../../../emails/order-confirmation";
import { OrderRefundedEmail } from "../../../emails/order-refunded";
import { OrderShippedEmail } from "../../../emails/order-shipped";
import {
  confirmationProps,
  type EmailFormat,
  greetingName,
  refundedProps,
  shippedProps,
} from "./props";
import { renderEmail } from "./render";

const format: EmailFormat = {
  locale: "en",
  timeZone: "Europe/Warsaw",
  storeName: "Shop",
  contactAddress: "orders@example.com",
  siteUrl: "https://shop.example",
};

const address = {
  fullName: "Ada Lovelace",
  line1: "ul. Długa 12",
  line2: "m. 4",
  postalCode: "00-238",
  city: "Warszawa",
  countryName: "Poland",
};

const lines = [
  {
    productName: "Linen shirt",
    variantLabel: "Blue / M",
    quantity: 2,
    unitPriceCents: 3900,
    lineTotalCents: 7800,
  },
  {
    productName: "Tote",
    variantLabel: null,
    quantity: 1,
    unitPriceCents: 1900,
    lineTotalCents: 1900,
  },
];

function confirmation(overrides: Partial<Parameters<typeof confirmationProps>[0]> = {}) {
  return confirmationProps(
    {
      number: 1042,
      customerName: "Ada Lovelace",
      currency: "EUR",
      address,
      // Late evening UTC is the next day in Warsaw.
      paidAt: new Date("2026-10-13T22:30:00Z"),
      subtotalCents: 9700,
      discountCents: 0,
      discountCode: null,
      shippingCents: 999,
      totalCents: 10699,
      termsVersion: new Date("2026-10-20T00:00:00.000Z"),
      lines,
      ...overrides,
    },
    format,
  );
}

// spec 0011, AC-4 to AC-7.
describe("greetingName", () => {
  it.each([
    ["Ada Lovelace", "Ada"],
    ["  Ada   Lovelace ", "Ada"],
    ["Ada", "Ada"],
    ["", null],
    ["   ", null],
    [null, null],
  ])("takes the first word of %j", (name, first) => {
    expect(greetingName(name)).toBe(first);
  });
});

describe("the confirmation", () => {
  it("has the subject, greeting, lines, totals, address and the shipping promise", async () => {
    const email = await renderEmail({ kind: "order_confirmation", props: confirmation() });

    expect(email.subject).toBe("Order #1042 confirmed");
    // React splits text nodes with <!-- --> in the HTML; the plain text version has none.
    const html = email.html.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
    for (const text of [html, email.text]) {
      expect(text).toContain("Hi Ada,");
      expect(text).toContain("Oct 14, 2026");
      expect(text).toContain("Linen shirt (Blue / M)");
      expect(text).toContain("€39.00");
      expect(text).toContain("€78.00");
      expect(text).toContain("€97.00");
      expect(text).toContain("€9.99");
      expect(text).toContain("€106.99");
      expect(text).toContain("ul. Długa 12");
      expect(text).toContain("We'll email you when your order ships.");
      expect(text).toContain("Questions? Reply to this email or write to orders@example.com.");
    }
    expect(email.html).not.toContain("Discount");
  });

  it("shows Free delivery, the discount, and Hello without a name", async () => {
    const email = await renderEmail({
      kind: "order_confirmation",
      props: confirmation({
        shippingCents: 0,
        discountCents: 500,
        discountCode: "SUMMER10",
        customerName: null,
      }),
    });
    expect(email.text).toContain("Hello,");
    expect(email.text).toContain("Free");
    // spec 0014, AC-15: the code is named on the discount row.
    expect(email.text).toContain("Discount (SUMMER10)");
    expect(email.text).toContain("−€5.00");
  });

  it("leaves the address section out when the order has none", async () => {
    const email = await renderEmail({
      kind: "order_confirmation",
      props: confirmation({ address: null }),
    });
    expect(email.html).not.toContain("Delivery address");
  });

  it("uses the store locale for lang, amounts and dates", async () => {
    const props = confirmationProps(
      {
        number: 1042,
        customerName: "Ada",
        currency: "PLN",
        address: null,
        paidAt: new Date("2026-10-13T10:00:00Z"),
        subtotalCents: 1000,
        discountCents: 0,
        discountCode: null,
        shippingCents: 0,
        totalCents: 1000,
        termsVersion: null,
        lines: [],
      },
      { ...format, locale: "pl-PL" },
    );
    const email = await renderEmail({ kind: "order_confirmation", props });
    expect(email.html).toContain('lang="pl-PL"');
    // Intl puts a no break space before the currency.
    expect(props.total.replace(/\s/g, " ")).toBe("10,00 zł");
    expect(props.paidDate).toBe("13 paź 2026");
  });

  // spec 0017, AC-14: the only links are the three legal pages, so nothing in the email leads
  // back to the order or the checkout.
  it("is accessible and private: one h1, presentation layout, a data table, only legal links, no images", async () => {
    const { html } = await renderEmail({ kind: "order_confirmation", props: confirmation() });

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('<th scope="col"');
    expect([...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "https://shop.example/terms",
      "https://shop.example/returns",
      "https://shop.example/privacy",
    ]);
    expect(html).not.toMatch(/<img\s/);
    expect(html).not.toContain("checkout");
  });

  describe("terms of sale (spec 0017, AC-14)", () => {
    it("names the accepted version as a long date, with the legal links", async () => {
      const email = await renderEmail({ kind: "order_confirmation", props: confirmation() });

      expect(email.text).toContain("Terms of sale version October 20, 2026 applied to this order.");
      for (const text of ["Terms of sale", "Returns", "Privacy policy"]) {
        expect(email.text).toContain(text);
      }
    });

    it("leaves the version line out for an order paid before it was recorded, keeping the links", async () => {
      const email = await renderEmail({
        kind: "order_confirmation",
        props: confirmation({ termsVersion: null }),
      });

      expect(email.text).not.toContain("applied to this order");
      expect(email.html).toContain('href="https://shop.example/terms"');
    });

    it("formats the version in the store locale, on the same day", () => {
      const props = confirmationProps(
        {
          number: 1,
          customerName: null,
          currency: "PLN",
          address: null,
          paidAt: new Date("2026-10-13T10:00:00Z"),
          subtotalCents: 1000,
          discountCents: 0,
          discountCode: null,
          shippingCents: 0,
          totalCents: 1000,
          termsVersion: new Date("2026-01-01T00:00:00.000Z"),
          lines: [],
        },
        { ...format, locale: "pl-PL", timeZone: "America/Los_Angeles" },
      );
      expect(props.termsVersionLabel).toBe("1 stycznia 2026");
    });
  });
});

describe("shipped", () => {
  const base = {
    number: 1042,
    customerName: "Ada",
    currency: "EUR",
    address,
    lines: lines.map(({ productName, variantLabel, quantity }) => ({
      productName,
      variantLabel,
      quantity,
    })),
  };

  it.each([
    ["DHL", "JD1", "Carrier: DHL, tracking number: JD1"],
    ["DHL", null, "Carrier: DHL"],
    [null, "JD1", "Tracking number: JD1"],
  ])("shows carrier %j and tracking %j as only the parts set", async (carrier, tracking, line) => {
    const email = await renderEmail({
      kind: "order_shipped",
      props: shippedProps({ ...base, carrier, trackingNumber: tracking }, format),
    });
    expect(email.subject).toBe("Order #1042 is on its way");
    expect(email.text).toContain(line);
    expect(email.text).toContain("Linen shirt (Blue / M)");
    expect(email.text).toContain("Warszawa");
  });

  it("has no tracking line when neither is set", async () => {
    const email = await renderEmail({
      kind: "order_shipped",
      props: shippedProps({ ...base, carrier: null, trackingNumber: null }, format),
    });
    expect(email.text).not.toMatch(/carrier|tracking number/i);
  });
});

describe("refunded", () => {
  const refund = (overrides: Partial<Parameters<typeof refundedProps>[0]> = {}) =>
    refundedProps(
      {
        order: { number: 1042, customerName: "Ada", currency: "EUR" },
        amountCents: 3900,
        includesShipping: false,
        cancelledWording: false,
        lines: [{ productName: "Linen shirt", variantLabel: "Blue / M", quantity: 1 }],
        ...overrides,
      },
      format,
    );

  it("shows the amount, the items and the bank delay", async () => {
    const email = await renderEmail({ kind: "order_refunded", props: refund() });
    expect(email.subject).toBe("Refund for order #1042");
    expect(email.text).toContain("€39.00");
    expect(email.text).toContain("Linen shirt (Blue / M)");
    expect(email.text).toContain(
      "Your bank usually shows the refund within 5 to 10 business days.",
    );
    expect(email.text).not.toContain("Delivery fee refunded");
    expect(email.text).not.toContain("cancelled");
  });

  it("says the delivery fee was refunded and leaves out an empty items list", async () => {
    const email = await renderEmail({
      kind: "order_refunded",
      props: refund({ includesShipping: true, lines: [] }),
    });
    expect(email.text).toContain("Delivery fee refunded");
    expect(email.html).not.toContain("Refunded items");
  });

  it("uses the frozen cancel wording", async () => {
    const email = await renderEmail({
      kind: "order_refunded",
      props: refund({ cancelledWording: true }),
    });
    expect(email.subject).toBe("Order #1042 cancelled and refunded");
    expect(email.text).toContain("Your order was cancelled and refunded in full.");
  });
});

describe("preview fixtures", () => {
  it.each([
    ["confirmation", OrderConfirmationEmail.PreviewProps, "order_confirmation"],
    ["shipped", OrderShippedEmail.PreviewProps, "order_shipped"],
    ["refunded", OrderRefundedEmail.PreviewProps, "order_refunded"],
  ] as const)("render the %s template", async (_, props, kind) => {
    const email = await renderEmail({ kind, props } as Parameters<typeof renderEmail>[0]);
    expect(email.html).toContain("Hi Anna,");
  });
});
