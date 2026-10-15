import { describe, expect, it } from "vitest";

import { addressMessages } from "@/lib/shipping/address";

import { accountMessages, fieldMessages } from "./messages";
import {
  changePasswordSchema,
  confirmLinkSchema,
  deleteAccountSchema,
  emailSchema,
  newPasswordSchema,
  profileSchema,
  signInSchema,
} from "./schemas";

// spec 0012: the account form schemas, which the forms and their actions both run.

function messages(result: { error?: { issues: readonly { message: string }[] } }) {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe("emailSchema (AC-1)", () => {
  it("trims and lower cases, so one address is one account", () => {
    expect(emailSchema.parse("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("gives the same value when run twice, as a form and then its action do", () => {
    const once = emailSchema.parse(" Ada@Example.COM");

    expect(emailSchema.parse(once)).toBe(once);
  });

  it.each([
    [undefined, fieldMessages.emailRequired],
    ["   ", fieldMessages.emailRequired],
    ["not-an-email", fieldMessages.emailInvalid],
    [`${"a".repeat(250)}@example.com`, fieldMessages.emailInvalid],
  ])("refuses %j with its field message", (value, message) => {
    expect(messages(emailSchema.safeParse(value))).toEqual([message]);
  });
});

describe("signInSchema (AC-4)", () => {
  it("needs a password but sets no rules on it, so an old password still signs in", () => {
    expect(signInSchema.parse({ email: "Ada@Example.com", password: "x" })).toEqual({
      email: "ada@example.com",
      password: "x",
    });
    expect(messages(signInSchema.safeParse({ email: "ada@example.com", password: "" }))).toEqual([
      fieldMessages.passwordRequired,
    ]);
  });
});

describe("newPasswordSchema (AC-3)", () => {
  it("accepts a strong password typed twice", () => {
    expect(
      newPasswordSchema.safeParse({ password: "Garden-gnome-42", confirm: "Garden-gnome-42" })
        .success,
    ).toBe(true);
  });

  it("puts a mismatch on the confirm field", () => {
    const result = newPasswordSchema.safeParse({
      password: "Garden-gnome-42",
      confirm: "Garden-gnome-43",
    });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["confirm"], message: accountMessages.mismatch }),
    ]);
  });

  it("refuses a weak password on the password field", () => {
    const result = newPasswordSchema.safeParse({ password: "short", confirm: "short" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.every((issue) => issue.path[0] === "password")).toBe(true);
  });
});

describe("confirmLinkSchema (AC-2)", () => {
  it.each(["signup", "recovery"] as const)("accepts a %s link", (type) => {
    expect(confirmLinkSchema.parse({ tokenHash: "abc", type })).toEqual({
      tokenHash: "abc",
      type,
    });
  });

  it.each([
    ["magiclink", "abc"],
    ["invite", "abc"],
    ["email_change", "abc"],
    ["signup", ""],
    ["signup", "x".repeat(513)],
  ])("treats type %s with a token of the wrong shape as an invalid link", (type, tokenHash) => {
    expect(confirmLinkSchema.safeParse({ tokenHash, type }).success).toBe(false);
  });
});

describe("profileSchema (AC-18)", () => {
  it("trims the name and keeps a valid phone", () => {
    expect(profileSchema.parse({ name: "  Ada Lovelace ", phone: "+48 600 100 200" })).toEqual({
      name: "Ada Lovelace",
      phone: "+48 600 100 200",
    });
  });

  it("reads a blank name and phone as cleared", () => {
    expect(profileSchema.parse({ name: "   ", phone: "" })).toEqual({ name: null, phone: null });
    expect(profileSchema.parse({})).toEqual({ name: null, phone: null });
  });

  it("gives the same value when run twice", () => {
    const once = profileSchema.parse({ name: " Ada ", phone: "" });

    expect(profileSchema.parse(once)).toEqual(once);
  });

  it("refuses phone 123 with checkout's message", () => {
    expect(messages(profileSchema.safeParse({ name: "Ada", phone: "123" }))).toEqual([
      addressMessages.phone,
    ]);
  });

  it("refuses a name over 100 characters", () => {
    expect(messages(profileSchema.safeParse({ name: "a".repeat(101) }))).toEqual([
      addressMessages.fullNameLong,
    ]);
    expect(profileSchema.safeParse({ name: "a".repeat(100) }).success).toBe(true);
  });
});

describe("changePasswordSchema (AC-19)", () => {
  it("needs the current password and a matching strong new one", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "",
      password: "Garden-gnome-42",
      confirm: "Garden-gnome-41",
    });

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual(
      expect.arrayContaining([
        ["currentPassword", fieldMessages.passwordRequired],
        ["confirm", accountMessages.mismatch],
      ]),
    );
  });
});

describe("deleteAccountSchema (AC-20)", () => {
  it("needs a password", () => {
    expect(messages(deleteAccountSchema.safeParse({ password: "" }))).toEqual([
      fieldMessages.passwordRequired,
    ]);
    expect(deleteAccountSchema.safeParse({ password: "anything" }).success).toBe(true);
  });
});
