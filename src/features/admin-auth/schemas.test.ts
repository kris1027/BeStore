import { describe, expect, it } from "vitest";

import { emailSchema, signInSchema } from "./schemas";

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
});
