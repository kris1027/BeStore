import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0012, AC-19 and AC-20: the current password check behind change password and delete account,
// with the stateless Supabase client mocked.

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseStatelessClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn } }));

const { checkPassword } = await import("./password-check");

const CUSTOMER_ID = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("checkPassword", () => {
  it("passes the right password and ends the throwaway session it made, locally", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: CUSTOMER_ID } },
      error: null,
    });

    expect(await checkPassword(CUSTOMER_ID, "ada@example.com", "Garden-gnome-42")).toEqual({
      ok: true,
    });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "Garden-gnome-42",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("refuses a wrong password without signing anyone out", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", status: 400 },
    });

    expect(await checkPassword(CUSTOMER_ID, "ada@example.com", "wrong")).toEqual({
      ok: false,
      failure: "rejected",
    });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("refuses a sign in that lands on another user", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "44444444-4444-4444-4444-444444444444" } },
      error: null,
    });

    expect(await checkPassword(CUSTOMER_ID, "ada@example.com", "Garden-gnome-42")).toEqual({
      ok: false,
      failure: "rejected",
    });
  });

  it("reports a rate limit as such", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "over_request_rate_limit", status: 429 },
    });

    expect(await checkPassword(CUSTOMER_ID, "ada@example.com", "x")).toEqual({
      ok: false,
      failure: "rate_limited",
    });
  });

  it("still passes when the throwaway sign out fails, and logs a code but no email", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: CUSTOMER_ID } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: { status: 500 } });

    expect(await checkPassword(CUSTOMER_ID, "ada@example.com", "Garden-gnome-42")).toEqual({
      ok: true,
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      { customerId: CUSTOMER_ID, reason: "unavailable" },
      "account.password_check.sign_out_failed",
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("ada@example.com");
  });
});
