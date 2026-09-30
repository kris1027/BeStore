import { describe, expect, it } from "vitest";

import { normalizePostalCode, shippingAddressSchema } from "./address";

// spec 0007, AC-2 and Validation messages.

const schema = shippingAddressSchema("PL");

const valid = {
  fullName: "Anna Kowalska",
  line1: "ul. Marszałkowska 1",
  line2: "",
  postalCode: "00-950",
  city: "Warsaw",
  phone: "",
};

function messageFor(overrides: Record<string, unknown>, field: string) {
  const result = schema.safeParse({ ...valid, ...overrides });
  return result.error?.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("normalizePostalCode", () => {
  it.each([
    ["00950", "00-950"],
    ["00-950", "00-950"],
    [" 00-950 ", "00-950"],
  ])("stores %j as %j", (text, stored) => {
    expect(normalizePostalCode("PL", text)).toBe(stored);
  });

  it.each(["00 950", "00–950", "0095", "009500", "ABCDE", "00--950", "٠٠-٩٥٠", ""])(
    "refuses %j",
    (text) => {
      expect(normalizePostalCode("PL", text)).toBeNull();
    },
  );
});

describe("shippingAddressSchema", () => {
  it("trims every field and stores empty optional fields as null", () => {
    expect(
      schema.parse({
        fullName: "  Anna Kowalska ",
        line1: " ul. Marszałkowska 1 ",
        line2: "   ",
        postalCode: "00950",
        city: " Warsaw ",
        phone: "  ",
      }),
    ).toEqual({
      fullName: "Anna Kowalska",
      line1: "ul. Marszałkowska 1",
      line2: null,
      postalCode: "00-950",
      city: "Warsaw",
      phone: null,
    });
  });

  it("gives the same output when it parses its own output again", () => {
    const once = schema.parse({
      ...valid,
      postalCode: "00950",
      line2: " m. 4 ",
      phone: " +48 600 100 200 ",
    });

    expect(schema.parse(once)).toEqual(once);
    expect(once).toMatchObject({ line2: "m. 4", phone: "+48 600 100 200" });
  });

  it("accepts a missing line 2 and phone", () => {
    const rest = { fullName: "A", line1: "B 1", postalCode: "00-950", city: "C" };

    expect(schema.parse(rest)).toMatchObject({ line2: null, phone: null });
  });

  it.each([
    ["fullName", "   ", "Enter your full name."],
    ["fullName", "a".repeat(101), "Keep your name under 100 characters."],
    ["line1", "", "Enter your street address."],
    ["line1", "a".repeat(101), "Keep this line under 100 characters."],
    ["line2", "a".repeat(101), "Keep this line under 100 characters."],
    ["city", " ", "Enter your city."],
    ["city", "a".repeat(61), "Keep the city under 60 characters."],
    ["postalCode", "00 950", "Enter a postal code like 00-950."],
    ["postalCode", "", "Enter a postal code like 00-950."],
  ])("refuses %s %j with %j", (field, value, message) => {
    expect(messageFor({ [field]: value }, field)).toBe(message);
  });

  it("accepts 100 characters for the name and lines and 60 for the city", () => {
    const long = "a".repeat(100);

    expect(
      schema.safeParse({ ...valid, fullName: long, line1: long, line2: long, city: "a".repeat(60) })
        .success,
    ).toBe(true);
  });

  it.each(["+48 600 100 200", "600100200", "(22) 123-45-67", "1234567", "123456789012345"])(
    "accepts the phone %j",
    (phone) => {
      expect(schema.parse({ ...valid, phone }).phone).toBe(phone);
    },
  );

  it.each(["123456", "1234567890123456", "600 100 200 ext 5", "600.100.200", "++48600100200"])(
    "refuses the phone %j",
    (phone) => {
      expect(messageFor({ phone }, "phone")).toBe(
        "Enter a phone number with 7 to 15 digits, or leave it empty.",
      );
    },
  );

  it("names every invalid field at once", () => {
    const result = schema.safeParse({
      fullName: "",
      line1: "",
      line2: "",
      postalCode: "x",
      city: "",
      phone: "1",
    });

    expect(new Set(result.error?.issues.map((issue) => issue.path[0]))).toEqual(
      new Set(["fullName", "line1", "postalCode", "city", "phone"]),
    );
  });
});
