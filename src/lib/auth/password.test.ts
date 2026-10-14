import { describe, expect, it } from "vitest";

import { isPasswordTooLong, missingPasswordRules, passwordSchema } from "./password";

describe("passwordSchema (spec 0004 AC-10, spec 0012 AC-3)", () => {
  it("accepts a password with all four classes and 8 characters", () => {
    expect(passwordSchema.safeParse("Abcdef1!").success).toBe(true);
  });

  it("names every missing part", () => {
    expect(missingPasswordRules("")).toEqual(["length", "lower", "upper", "digit", "symbol"]);
    expect(missingPasswordRules("short")).toEqual(["length", "upper", "digit", "symbol"]);
    const result = passwordSchema.safeParse("abcdefgh");
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "An upper case letter",
      "A digit",
      "A symbol",
    ]);
  });

  it("counts only the symbols Supabase counts", () => {
    expect(missingPasswordRules("Abcdefg1€")).toEqual(["symbol"]);
    expect(missingPasswordRules("Abcdefg1~")).toEqual([]);
  });

  it("refuses more than 72 bytes, counting multi byte characters", () => {
    expect(isPasswordTooLong(`Aa1!${"x".repeat(68)}`)).toBe(false);
    expect(isPasswordTooLong(`Aa1!${"x".repeat(69)}`)).toBe(true);
    expect(isPasswordTooLong(`Aa1!${"é".repeat(35)}`)).toBe(true);
    expect(passwordSchema.safeParse(`Aa1!${"x".repeat(69)}`).success).toBe(false);
  });
});
