import { describe, expect, it } from "vitest";

import { checkoutFieldErrors, checkoutSchema, sessionIdSchema } from "./schemas";

// spec 0006, AC-1, AC-2 and AC-11; spec 0007, AC-2.

const schema = checkoutSchema("PL");

const address = {
  fullName: "Anna Kowalska",
  line1: "ul. Marszałkowska 1",
  line2: "",
  postalCode: "00950",
  city: "Warsaw",
  phone: "",
};

describe("checkoutSchema", () => {
  it("trims and lowercases the email and cleans the address", () => {
    expect(schema.parse({ email: "  Ada.Lovelace@Example.COM ", ...address })).toEqual({
      email: "ada.lovelace@example.com",
      fullName: "Anna Kowalska",
      line1: "ul. Marszałkowska 1",
      line2: null,
      postalCode: "00-950",
      city: "Warsaw",
      phone: null,
    });
  });

  it("parses its own output to the same values, as the server does after the form", () => {
    const once = schema.parse({ email: "Ada@Example.com", ...address });

    expect(schema.parse(once)).toEqual(once);
  });

  it.each(["", "   ", "not-an-email", "a@", `${"a".repeat(250)}@x.io`])(
    "refuses the email %j with the field message",
    (email) => {
      const result = schema.safeParse({ email, ...address });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Enter a valid email address.");
    },
  );

  it.each([undefined, 42])("refuses the email %j with the field message", (email) => {
    expect(schema.safeParse({ email, ...address }).error?.issues[0]?.message).toBe(
      "Enter a valid email address.",
    );
  });

  it("refuses a request without an address", () => {
    expect(schema.safeParse({ email: "a@example.com" }).success).toBe(false);
  });

  it("drops fields it does not know, like a fee sent by the browser", () => {
    const parsed = schema.parse({ email: "a@example.com", ...address, shippingCents: 0 });

    expect(parsed).not.toHaveProperty("shippingCents");
  });
});

describe("checkoutFieldErrors", () => {
  it("maps each invalid field to its first message", () => {
    const result = schema.safeParse({ ...address, email: "x", city: "", postalCode: "1" });

    if (result.success) throw new Error("expected the input to be refused");

    expect(checkoutFieldErrors(result.error)).toEqual({
      email: "Enter a valid email address.",
      city: "Enter your city.",
      postalCode: "Enter a postal code like 00-950.",
    });
  });
});

describe("sessionIdSchema", () => {
  it.each(["cs_test_a1B2c3", "cs_live_XyZ09"])("accepts %s", (id) => {
    expect(sessionIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(["", "cs_test_", "pi_test_abc", "cs_test_abc/../x", "cs_prod_abc"])(
    "refuses %j",
    (id) => {
      expect(sessionIdSchema.safeParse(id).success).toBe(false);
    },
  );
});
