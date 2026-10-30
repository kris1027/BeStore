import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authEmailKind,
  authEmailLink,
  authIdempotencyKey,
  hookPayloadSchema,
  hookSecretKey,
  isStoreRunnerReset,
  usedActionType,
} from "./auth-hook";

// spec 0012, AC-8.

describe("usedActionType", () => {
  it("keeps sign up and recovery and refuses every other type", () => {
    expect(usedActionType("signup")).toBe("signup");
    expect(usedActionType("recovery")).toBe("recovery");
    for (const type of ["magiclink", "invite", "email_change", "reauthentication", "email"]) {
      expect(usedActionType(type)).toBeNull();
    }
  });
});

describe("isStoreRunnerReset (spec 0019, AC-8)", () => {
  it("skips only a reset for someone who runs the store", () => {
    expect(isStoreRunnerReset("recovery", true)).toBe(true);
    expect(isStoreRunnerReset("recovery", false)).toBe(false);
    expect(isStoreRunnerReset("signup", true)).toBe(false);
    expect(isStoreRunnerReset("signup", false)).toBe(false);
  });
});

describe("authEmailKind", () => {
  it("confirms a sign up and resets a customer", () => {
    expect(authEmailKind("signup")).toBe("confirm_signup");
    expect(authEmailKind("recovery")).toBe("customer_reset");
  });
});

describe("authEmailLink", () => {
  const site = "https://shop.example";

  it("points every link at /account/confirm", () => {
    expect(authEmailLink(site, "signup", "abc")).toBe(
      "https://shop.example/account/confirm?token_hash=abc&type=signup",
    );
    expect(authEmailLink(site, "recovery", "abc")).toBe(
      "https://shop.example/account/confirm?token_hash=abc&type=recovery",
    );
  });

  it("encodes the token hash", () => {
    expect(authEmailLink(site, "signup", "a&b=c")).toContain("token_hash=a%26b%3Dc");
  });
});

describe("authIdempotencyKey", () => {
  it("is the type plus the SHA 256 of the token hash, never the hash itself", () => {
    const key = authIdempotencyKey("signup", "pkce_secret");
    const digest = createHash("sha256").update("pkce_secret").digest("hex");

    expect(key).toBe(`auth:signup:${digest}`);
    expect(key).not.toContain("pkce_secret");
  });
});

describe("hookSecretKey", () => {
  it("strips the v1,whsec_ prefix Supabase shows", () => {
    expect(hookSecretKey("v1,whsec_abc123==")).toBe("abc123==");
  });
});

describe("hookPayloadSchema", () => {
  it("needs a user id and email and a token hash", () => {
    const valid = {
      user: { id: "8b4a7e2c-3f6d-4c1a-9e8b-2d5f7a1c3e9b", email: "ada@example.com" },
      email_data: { token_hash: "abc", email_action_type: "signup", redirect_to: "x" },
    };
    expect(hookPayloadSchema.safeParse(valid).success).toBe(true);
    expect(
      hookPayloadSchema.safeParse({ ...valid, email_data: { email_action_type: "signup" } })
        .success,
    ).toBe(false);
  });
});
