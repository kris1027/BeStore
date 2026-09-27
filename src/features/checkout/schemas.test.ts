import { describe, expect, it } from "vitest";

import { checkoutSchema, sessionIdSchema } from "./schemas";

// spec 0006, AC-1, AC-2 and AC-11.

describe("checkoutSchema", () => {
  it("trims and lowercases the email", () => {
    expect(checkoutSchema.parse({ email: "  Ada.Lovelace@Example.COM " })).toEqual({
      email: "ada.lovelace@example.com",
    });
  });

  it.each(["", "   ", "not-an-email", "a@", `${"a".repeat(250)}@x.io`])(
    "refuses %j with the field message",
    (email) => {
      const result = checkoutSchema.safeParse({ email });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Enter a valid email address.");
    },
  );
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
