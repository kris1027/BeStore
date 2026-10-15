import { describe, expect, it } from "vitest";

import { isPasswordTooLong, missingPasswordRules } from "@/lib/auth/password";

import { throwawayPassword } from "./throwaway-password";

describe("throwawayPassword (AC-1)", () => {
  it("meets the password policy and fits the 72 byte limit", () => {
    const password = throwawayPassword();

    expect(missingPasswordRules(password)).toEqual([]);
    expect(isPasswordTooLong(password)).toBe(false);
    expect(password).toHaveLength(47);
  });

  it("is different every time", () => {
    expect(throwawayPassword()).not.toBe(throwawayPassword());
  });
});
