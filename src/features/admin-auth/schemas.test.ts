import { describe, expect, it } from "vitest";

import { emailSchema, resetPasswordSchema, signInSchema, totpCodeSchema } from "./schemas";

describe("form schemas", () => {
  it("lower cases and trims the email", () => {
    expect(emailSchema.parse("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("gives the fixed field messages", () => {
    const empty = signInSchema.safeParse({ email: "", password: "" });
    expect(empty.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter your email address",
      "Enter your password",
    ]);
    expect(signInSchema.safeParse({ email: "nope", password: "x" }).error?.issues[0]?.message).toBe(
      "Enter a valid email address",
    );
  });

  it("accepts a 6 digit code with spaces and rejects anything else", () => {
    expect(totpCodeSchema.parse({ code: "123 456" })).toEqual({ code: "123456" });
    for (const code of ["12345", "1234567", "abcdef", ""]) {
      expect(totpCodeSchema.safeParse({ code }).error?.issues[0]?.message).toBe(
        "Enter the 6 digit code",
      );
    }
  });

  it("requires the two new passwords to match", () => {
    const result = resetPasswordSchema.safeParse({ password: "Abcdef1!", confirm: "Abcdef1?" });
    expect(result.error?.issues).toMatchObject([
      { path: ["confirm"], message: "The passwords do not match." },
    ]);
  });
});
