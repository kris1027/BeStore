import { beforeEach, describe, expect, it, vi } from "vitest";

import { signIn } from "./sign-in";

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string) => {
      throw new NavigationSignal(`redirect:${url}`);
    }),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    findAdmin: vi.fn(),
    clearAuthCookies: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findUnique: mocks.findAdmin } } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
  clearAuthCookies: mocks.clearAuthCookies,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn } }));

const USER_ID = "22222222-2222-2222-2222-222222222222";
const PASSWORD = "Correct-Horse-9!";
const credentials = { email: "Admin@Example.com ", password: PASSWORD };

async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof mocks.NavigationSignal) return error.message;
    throw error;
  }
}

function passwordAccepted() {
  mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
}

function allLogOutput() {
  return JSON.stringify([...mocks.info.mock.calls, ...mocks.warn.mock.calls]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signIn", () => {
  // covers: AC-3
  it("returns field errors for an empty form without calling the Auth server", async () => {
    const result = await signIn({ email: "", password: "" }, undefined);

    expect(result).toEqual({
      ok: false,
      error: {
        fields: { email: ["Enter your email address"], password: ["Enter your password"] },
      },
    });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects input that is not an object", async () => {
    const result = await signIn("admin@example.com", undefined);

    expect(result.ok).toBe(false);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in with the trimmed, lower cased email", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue({ id: USER_ID, disabledAt: null });

    await outcome(() => signIn(credentials, undefined));

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: PASSWORD,
    });
  });

  // covers: AC-2
  it("sends an active admin on to the MFA step, keeping a safe next", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue({ id: USER_ID, disabledAt: null });

    await expect(outcome(() => signIn(credentials, "/admin/orders?status=paid"))).resolves.toBe(
      "redirect:/admin/mfa?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    );
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "auth.sign_in.succeeded", adminId: USER_ID, ip: "203.0.113.7" },
      "auth.sign_in.succeeded",
    );
  });

  // covers: AC-12
  it("drops a next that points off site", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue({ id: USER_ID, disabledAt: null });

    await expect(outcome(() => signIn(credentials, "//evil.example/admin"))).resolves.toBe(
      "redirect:/admin/mfa?next=%2Fadmin",
    );
  });

  it("goes to the bare MFA step when next is not a string", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue({ id: USER_ID, disabledAt: null });

    await expect(outcome(() => signIn(credentials, { next: "/admin" }))).resolves.toBe(
      "redirect:/admin/mfa",
    );
  });

  // covers: AC-3
  it("answers a wrong password with the shared message", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", status: 400 },
    });

    const result = await signIn(credentials, undefined);

    expect(result).toEqual({ ok: false, error: { form: "invalid_credentials" } });
    expect(mocks.findAdmin).not.toHaveBeenCalled();
  });

  // covers: AC-3 (the form cannot reveal who is an admin)
  it("answers a real password of a user who is not an admin exactly like a wrong password", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue(null);

    const result = await signIn(credentials, undefined);

    expect(result).toEqual({ ok: false, error: { form: "invalid_credentials" } });
  });

  // covers: AC-3 (no session cookie remains for a non admin)
  it("ends the session it just opened for a user who is not an admin", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue(null);

    await signIn(credentials, undefined);

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  // covers: AC-6
  it("refuses a disabled admin with the shared message and ends the session", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue({ id: USER_ID, disabledAt: new Date() });

    const result = await signIn(credentials, undefined);

    expect(result).toEqual({ ok: false, error: { form: "invalid_credentials" } });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("reports a rate limit from the Auth server", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "over_request_rate_limit", status: 429 },
    });

    await expect(signIn(credentials, undefined)).resolves.toEqual({
      ok: false,
      error: { form: "rate_limited" },
    });
  });

  it("reports an Auth outage as unavailable", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status: 502 } });

    await expect(signIn(credentials, undefined)).resolves.toEqual({
      ok: false,
      error: { form: "unavailable" },
    });
  });

  // covers: AC-13
  it("logs a failed attempt with a hashed email and never the address or password", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", status: 400 },
    });

    await signIn(credentials, undefined);

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth.sign_in.failed",
        emailHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        reason: "invalid_credentials",
      }),
      "auth.sign_in.failed",
    );
    expect(allLogOutput()).not.toContain("admin@example.com");
    expect(allLogOutput()).not.toContain(PASSWORD);
  });

  // covers: AC-13
  it("logs a non admin attempt with its own reason, still without the address", async () => {
    passwordAccepted();
    mocks.findAdmin.mockResolvedValue(null);

    await signIn(credentials, undefined);

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.sign_in.failed", reason: "not_admin" }),
      "auth.sign_in.failed",
    );
    expect(allLogOutput()).not.toContain("admin@example.com");
  });
});
