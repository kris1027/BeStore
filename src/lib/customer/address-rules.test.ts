import { describe, expect, it } from "vitest";

import { addressNeedsCheck, normalizeAddress, sameAddress } from "./address-rules";

const saved = {
  fullName: "Ada Lovelace",
  line1: "ul. Długa 1",
  line2: null,
  postalCode: "00-950",
  city: "Warsaw",
  phone: null,
  countryCode: "PL",
};

describe("normalizeAddress", () => {
  it("trims every field and reads an empty line 2 or phone as null", () => {
    expect(
      normalizeAddress({ ...saved, fullName: "  Ada Lovelace ", line2: "  ", phone: "" }),
    ).toEqual(saved);
  });
});

describe("sameAddress (AC-15)", () => {
  it("treats null and empty alike and compares every field", () => {
    expect(sameAddress(saved, { ...saved, line2: "", phone: " " })).toBe(true);
    expect(sameAddress(saved, { ...saved, city: "Kraków" })).toBe(false);
    expect(sameAddress(saved, { ...saved, phone: "+48 600 100 200" })).toBe(false);
  });
});

describe("addressNeedsCheck (AC-14)", () => {
  it("accepts an address the current rules accept", () => {
    expect(addressNeedsCheck(saved, "PL")).toBe(false);
  });

  it("flags another country, a bad postal code or a field the rules now refuse", () => {
    expect(addressNeedsCheck({ ...saved, countryCode: "DE" }, "PL")).toBe(true);
    expect(addressNeedsCheck({ ...saved, postalCode: "12345" }, "PL")).toBe(true);
    expect(addressNeedsCheck({ ...saved, fullName: "x".repeat(101) }, "PL")).toBe(true);
    // Stored unnormalized (00950): the rules would store it differently.
    expect(addressNeedsCheck({ ...saved, postalCode: "00950" }, "PL")).toBe(true);
  });
});
