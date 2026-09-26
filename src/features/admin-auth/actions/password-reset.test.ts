import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmResetLink, requestPasswordReset, resetPassword } from "./password-reset";

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string) => {
      throw new NavigationSignal(`redirect:${url}`);
    }),
    afterCallbacks: [] as (() => Promise<void>)[],
    requireAdminSession: vi.fn(),
    findFirst: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    mocks.afterCallbacks.push(callback);
  },
}));
vi.mock("../require-admin", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { verifyOtp: mocks.verifyOtp, updateUser: mocks.updateUser, signOut: mocks.signOut },
  }),
  createSupabaseStatelessClient: () => ({
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: mocks.error },
}));

const ADMIN_ID = "admin-1";
const NEW_PASSWORD = "Fresh-Start-42!";

async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof mocks.NavigationSignal) return error.message;
    throw error;
  }
}

async function runAfterCallbacks() {
  for (const callback of mocks.afterCallbacks) await callback();
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.requireAdminSession.mockResolvedValue({
    admin: { id: ADMIN_ID, email: "admin@example.com", name: "Ada" },
    aal: "aal2",
    fromResetLink: true,
  });
  mocks.updateUser.mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("requestPasswordReset", () => {
  // covers: AC-9
  it("sends the reset email to an active admin after the reply", async () => {
    mocks.findFirst.mockResolvedValue({ id: ADMIN_ID });

    const result = await requestPasswordReset({ email: " Admin@Example.com" });

    expect(result).toEqual({ ok: true, data: null });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("admin@example.com");
  });

  // covers: AC-9 (same answer whether or not the email is an admin's)
  it("gives an unknown email the same reply and sends nothing", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const result = await requestPasswordReset({ email: "stranger@example.com" });
    await runAfterCallbacks();

    expect(result).toEqual({ ok: true, data: null });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.reset.requested", sent: false }),
      "auth.reset.requested",
    );
  });

  it("looks up only admins who are not disabled", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await requestPasswordReset({ email: "admin@example.com" });

    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "admin@example.com", disabledAt: null } }),
    );
  });

  it("still answers the same when the email cannot be sent, and logs the failure", async () => {
    mocks.findFirst.mockResolvedValue({ id: ADMIN_ID });
    mocks.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: "over_email_send_rate_limit", status: 429 },
    });

    const result = await requestPasswordReset({ email: "admin@example.com" });
    await runAfterCallbacks();

    expect(result).toEqual({ ok: true, data: null });
    expect(mocks.error).toHaveBeenCalledWith(
      { adminId: ADMIN_ID, reason: "rate_limited" },
      "auth.reset.send_failed",
    );
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: ADMIN_ID, sent: false }),
      "auth.reset.requested",
    );
  });

  it("never logs the email address", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await requestPasswordReset({ email: "stranger@example.com" });
    await runAfterCallbacks();

    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("stranger@example.com");
  });

  it("returns a field error for an invalid email without a lookup", async () => {
    const result = await requestPasswordReset({ email: "not-an-email" });

    expect(result).toEqual({
      ok: false,
      error: { fields: { email: ["Enter a valid email address"] } },
    });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });
});

describe("confirmResetLink", () => {
  // covers: AC-10 (the inbox alone is not enough: the TOTP step comes first)
  it("spends the token and sends the admin through the MFA step to the reset page", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null });

    await expect(
      outcome(() => confirmResetLink(form({ token_hash: "hash-1", type: "recovery" }))),
    ).resolves.toBe("redirect:/admin/mfa?next=%2Fadmin%2Freset-password");
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "hash-1" });
  });

  // covers: AC-9
  it("sends a used or expired link to sign in with invalid_link", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: null, error: { status: 403 } });

    await expect(
      outcome(() => confirmResetLink(form({ token_hash: "used", type: "recovery" }))),
    ).resolves.toBe("redirect:/admin/sign-in?reason=invalid_link");
  });

  it.each([
    ["a missing token", { type: "recovery" }],
    ["an empty token", { token_hash: "", type: "recovery" }],
    ["a token of another type", { token_hash: "hash-1", type: "magiclink" }],
  ])("refuses %s without calling the Auth server", async (_label, fields) => {
    await expect(outcome(() => confirmResetLink(form(fields)))).resolves.toBe(
      "redirect:/admin/sign-in?reason=invalid_link",
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  const values = { password: NEW_PASSWORD, confirm: NEW_PASSWORD };

  // covers: AC-5 (a new password needs a full aal2 session)
  it("runs behind the full guard, not the aal1 one", async () => {
    await outcome(() => resetPassword(values));

    expect(mocks.requireAdminSession).toHaveBeenCalledWith();
  });

  // covers: AC-10
  it("sets the new password, signs out other sessions and opens the panel", async () => {
    await expect(outcome(() => resetPassword(values))).resolves.toBe("redirect:/admin");
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: NEW_PASSWORD });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "auth.password.changed", adminId: ADMIN_ID, ip: "203.0.113.7" },
      "auth.password.changed",
    );
  });

  // covers: AC-10
  it("still finishes the reset, and logs it, when other sessions cannot be signed out", async () => {
    mocks.signOut.mockResolvedValue({ error: { status: 503 } });

    await expect(outcome(() => resetPassword(values))).resolves.toBe("redirect:/admin");
    expect(mocks.error).toHaveBeenCalledWith(
      { adminId: ADMIN_ID, reason: "unavailable" },
      "auth.password.revoke_others_failed",
    );
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.password.changed", adminId: ADMIN_ID }),
      "auth.password.changed",
    );
  });

  // covers: AC-10
  it("names each missing part of a weak password without calling the Auth server", async () => {
    const result = await resetPassword({ password: "short", confirm: "short" });

    expect(result).toEqual({
      ok: false,
      error: {
        fields: {
          password: ["At least 8 characters", "An upper case letter", "A digit", "A symbol"],
        },
      },
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("flags a confirmation that does not match", async () => {
    const result = await resetPassword({ password: NEW_PASSWORD, confirm: "Other-Pass-42!" });

    expect(result).toEqual({
      ok: false,
      error: { fields: { confirm: ["The passwords do not match."] } },
    });
  });

  // covers: AC-10
  it("asks for a password not used before when Supabase says it is the same", async () => {
    mocks.updateUser.mockResolvedValue({
      data: null,
      error: { code: "same_password", status: 422 },
    });

    await expect(resetPassword(values)).resolves.toEqual({
      ok: false,
      error: { form: "same_password" },
    });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("logs a policy mismatch when Supabase finds a password weak that the schema allowed", async () => {
    mocks.updateUser.mockResolvedValue({
      data: null,
      error: { code: "weak_password", status: 422 },
    });

    await expect(resetPassword(values)).resolves.toEqual({
      ok: false,
      error: { form: "unavailable" },
    });
    expect(mocks.error).toHaveBeenCalledWith(
      { adminId: ADMIN_ID },
      "auth.password.policy_mismatch",
    );
  });

  it("reports any other failure as unavailable", async () => {
    mocks.updateUser.mockResolvedValue({ data: null, error: { status: 500 } });

    await expect(resetPassword(values)).resolves.toEqual({
      ok: false,
      error: { form: "unavailable" },
    });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("never logs the new password", async () => {
    await outcome(() => resetPassword(values));

    const logged = JSON.stringify([...mocks.info.mock.calls, ...mocks.error.mock.calls]);
    expect(logged).not.toContain(NEW_PASSWORD);
  });
});
