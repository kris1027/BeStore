import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0012: the account auth actions with Supabase and the database at the edges mocked
// (AC-1 to AC-4, AC-6, AC-9, AC-24). The real flows run in tests/e2e/account.

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string) => {
      throw new NavigationSignal(`redirect:${url}`);
    }),
    after: vi.fn(),
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    statelessSignUp: vi.fn(),
    statelessResend: vi.fn(),
    statelessReset: vi.fn(),
    runsTheStore: vi.fn(),
    accountSetup: vi.fn(),
    clearCartCookie: vi.fn(),
    clearAuthCookies: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  RedirectType: { replace: "replace", push: "push" },
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SITE_URL: "https://shop.example" } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
      verifyOtp: mocks.verifyOtp,
      updateUser: mocks.updateUser,
    },
  }),
  createSupabaseStatelessClient: () => ({
    auth: {
      signUp: mocks.statelessSignUp,
      resend: mocks.statelessResend,
      resetPasswordForEmail: mocks.statelessReset,
    },
  }),
  clearAuthCookies: mocks.clearAuthCookies,
}));
vi.mock("@/lib/customer/store-admin", () => ({ runsTheStore: mocks.runsTheStore }));
vi.mock("@/lib/customer/setup", () => ({ accountSetup: mocks.accountSetup }));
vi.mock("@/lib/cart/cookie", () => ({ clearCartCookie: mocks.clearCartCookie }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
}));

const { confirmEmail } = await import("./confirm");
const { requestPasswordReset } = await import("./password-reset");
const { setPassword } = await import("./set-password");
const { signInCustomer, signOutCustomer } = await import("./sign-in");
const { resendConfirmation, signUp } = await import("./sign-up");

const USER_ID = "33333333-3333-3333-3333-333333333333";
const confirmedUser = {
  id: USER_ID,
  email: "Ada@Example.com",
  email_confirmed_at: "2026-10-14T10:00:00Z",
};

async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof mocks.NavigationSignal) return error.message;
    throw error;
  }
}

// Runs whatever the action scheduled with after().
async function runAfter() {
  for (const [task] of mocks.after.mock.calls) await (task as () => Promise<void>)();
}

function logged(): string {
  return JSON.stringify([
    ...mocks.info.mock.calls,
    ...mocks.warn.mock.calls,
    ...mocks.error.mock.calls,
  ]);
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.runsTheStore.mockResolvedValue(false);
  mocks.accountSetup.mockResolvedValue({ ok: true, linked: 0 });
  mocks.statelessSignUp.mockResolvedValue({ error: null });
  mocks.statelessResend.mockResolvedValue({ error: null });
  mocks.statelessReset.mockResolvedValue({ error: null });
});

describe("signUp (AC-1)", () => {
  it("answers before Supabase runs, with a throwaway password and a lower cased email", async () => {
    const result = await signUp({ email: "  Ada@Example.COM " });

    expect(result).toEqual({ ok: true, data: null });
    expect(mocks.statelessSignUp).not.toHaveBeenCalled();
    await runAfter();
    const [call] = mocks.statelessSignUp.mock.calls[0]!;
    expect(call.email).toBe("ada@example.com");
    expect(call.password).toMatch(/^[A-Za-z0-9_-]{43}aA1!$/);
  });

  it("gives the same answer when Supabase refuses, and only logs a reason code", async () => {
    mocks.statelessSignUp.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", status: 429, message: "ada@example.com" },
    });

    expect(await signUp({ email: "ada@example.com" })).toEqual({ ok: true, data: null });
    await runAfter();
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "account.sign_up", reason: "rate_limited", sent: false },
      "account.sign_up",
    );
    expect(logged()).not.toContain("ada@example.com");
    expect(logged()).not.toContain("aA1!");
  });

  it("returns the field error for an email that is not one, without calling Supabase", async () => {
    const result = await signUp({ email: "not-an-email" });

    expect(result).toEqual({
      ok: false,
      error: { fields: { email: ["Enter a valid email address."] } },
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("resends the confirm link the same way", async () => {
    expect(await resendConfirmation({ email: "ada@example.com" })).toEqual({
      ok: true,
      data: null,
    });
    await runAfter();
    expect(mocks.statelessResend).toHaveBeenCalledWith({
      type: "signup",
      email: "ada@example.com",
    });
  });
});

describe("confirmEmail (AC-2)", () => {
  beforeEach(() => {
    mocks.updateUser.mockResolvedValue({ data: { user: confirmedUser }, error: null });
  });

  it("spends the token and sends a sign up to choose a password", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: confirmedUser }, error: null });

    const result = await outcome(() => confirmEmail(form({ token_hash: "abc", type: "signup" })));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc" });
    expect(result).toBe("redirect:/account/set-password");
  });

  // A password planted by a direct Supabase sign up must not survive a customer who confirms and
  // then leaves set password without choosing one.
  it("replaces the sign up password with a throwaway and ends other sessions", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: confirmedUser }, error: null });

    await outcome(() => confirmEmail(form({ token_hash: "abc", type: "signup" })));

    const [call] = mocks.updateUser.mock.calls[0]!;
    expect(call.password).toMatch(/^[A-Za-z0-9_-]{43}aA1!$/);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("still sends the customer to choose a password when the replace fails, and logs a code", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: confirmedUser }, error: null });
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error: { status: 500 } });

    const result = await outcome(() => confirmEmail(form({ token_hash: "abc", type: "signup" })));

    expect(result).toBe("redirect:/account/set-password");
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: USER_ID }),
      "account.confirm.password_replace_failed",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("sends a recovery to the new password page with the reset wording", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: confirmedUser }, error: null });

    const result = await outcome(() => confirmEmail(form({ token_hash: "abc", type: "recovery" })));

    expect(result).toBe("redirect:/account/set-password?from=reset");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("sends anyone who runs the store to the authenticator step instead", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: confirmedUser }, error: null });
    mocks.runsTheStore.mockResolvedValue(true);

    const result = await outcome(() => confirmEmail(form({ token_hash: "abc", type: "recovery" })));

    expect(result).toBe("redirect:/admin/mfa?next=%2Fadmin%2Freset-password");
  });

  it("shows the expired message for a used token and never verifies another type", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: { status: 403 } });

    expect(await outcome(() => confirmEmail(form({ token_hash: "abc", type: "signup" })))).toBe(
      "redirect:/account/confirm?failed=1&type=signup",
    );
    expect(await outcome(() => confirmEmail(form({ token_hash: "abc", type: "magiclink" })))).toBe(
      "redirect:/account/confirm?failed=1",
    );
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
  });
});

describe("setPassword (AC-3)", () => {
  const values = { password: "Garden-gnome-42", confirm: "Garden-gnome-42" };

  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: confirmedUser } });
    mocks.updateUser.mockResolvedValue({ data: { user: confirmedUser }, error: null });
  });

  it("sets the password, ends the other sessions, runs account setup and lands on /account", async () => {
    const result = await outcome(() => setPassword(values, "signup"));

    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "Garden-gnome-42" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mocks.accountSetup).toHaveBeenCalledWith({ id: USER_ID, email: "ada@example.com" });
    expect(result).toBe("redirect:/account?notice=ready");
  });

  it("says the password changed after a reset", async () => {
    expect(await outcome(() => setPassword(values, "reset"))).toBe(
      "redirect:/account?notice=password_changed",
    );
  });

  it("needs a session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    expect(await setPassword(values, "signup")).toEqual({
      ok: false,
      error: { form: "session_missing" },
    });
  });

  it("refuses anyone who runs the store", async () => {
    mocks.runsTheStore.mockResolvedValue(true);

    expect(await setPassword(values, "reset")).toEqual({
      ok: false,
      error: { form: "runs_the_store" },
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "weak_password", status: 422, reasons: ["pwned"] }, "leaked_password"],
    [{ code: "same_password", status: 422 }, "same_password"],
  ])("maps Supabase's %j to %s", async (error, form) => {
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error });

    expect(await setPassword(values, "signup")).toEqual({ ok: false, error: { form } });
  });

  it("returns every missing part of a weak password", async () => {
    const result = await setPassword({ password: "short", confirm: "short" }, "signup");

    expect(result).toMatchObject({ ok: false, error: { fields: { password: expect.any(Array) } } });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("reports a failed account setup", async () => {
    mocks.accountSetup.mockResolvedValue({ ok: false, error: "email_conflict" });

    expect(await setPassword(values, "signup")).toEqual({
      ok: false,
      error: { form: "setup_failed" },
    });
  });
});

describe("signInCustomer (AC-4)", () => {
  const values = { email: "Ada@Example.com", password: "Garden-gnome-42" };

  it("signs in, runs account setup and goes to a safe next", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: confirmedUser }, error: null });

    expect(await outcome(() => signInCustomer(values, "/checkout"))).toBe("redirect:/checkout");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "Garden-gnome-42",
    });
    expect(mocks.accountSetup).toHaveBeenCalledWith({ id: USER_ID, email: "ada@example.com" });
  });

  it("ignores an unsafe next", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: confirmedUser }, error: null });

    expect(await outcome(() => signInCustomer(values, "https://evil.example"))).toBe(
      "redirect:/account",
    );
  });

  it("never replaces a live session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: confirmedUser } });

    expect(await outcome(() => signInCustomer(values, null))).toBe("redirect:/account");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "invalid_credentials", status: 400 }, "invalid_credentials"],
    [{ code: "email_not_confirmed", status: 400 }, "invalid_credentials"],
    [{ code: "over_request_rate_limit", status: 429 }, "rate_limited"],
  ])("answers %j as %s and logs no email", async (error, form) => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error });

    expect(await signInCustomer(values, null)).toEqual({ ok: false, error: { form } });
    expect(logged()).not.toContain("ada@example.com");
  });

  // covers: AC-10 (value sourcing): a stale cookie of another account reads as no session, and
  // setup runs for the user Supabase signed in, never for the typed email.
  it("runs account setup for the user Supabase returned", async () => {
    const grace = {
      id: "44444444-4444-4444-4444-444444444444",
      email: "Grace@Example.com",
      email_confirmed_at: "2026-10-14T10:00:00Z",
    };
    mocks.signInWithPassword.mockResolvedValue({ data: { user: grace }, error: null });

    expect(await outcome(() => signInCustomer(values, null))).toBe("redirect:/account");
    expect(mocks.accountSetup).toHaveBeenCalledWith({ id: grace.id, email: "grace@example.com" });
  });

  it("ends the session of an unconfirmed user and answers with the usual message", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { ...confirmedUser, email_confirmed_at: undefined } },
      error: null,
    });

    expect(await signInCustomer(values, null)).toEqual({
      ok: false,
      error: { form: "invalid_credentials" },
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.accountSetup).not.toHaveBeenCalled();
  });

  it("ends the session when account setup fails", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: confirmedUser }, error: null });
    mocks.accountSetup.mockResolvedValue({ ok: false, error: "email_conflict" });

    expect(await signInCustomer(values, null)).toEqual({
      ok: false,
      error: { form: "unavailable" },
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("signOutCustomer (AC-6)", () => {
  it("signs out this browser only, forgets the cart and replaces the page with the home page", async () => {
    expect(await outcome(() => signOutCustomer())).toBe("redirect:/");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.clearCartCookie).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/", "replace");
  });
});

describe("requestPasswordReset (AC-9)", () => {
  it("answers at once and asks Supabase afterwards, with the account redirect", async () => {
    expect(await requestPasswordReset({ email: "Ada@Example.com" })).toEqual({
      ok: true,
      data: null,
    });
    expect(mocks.statelessReset).not.toHaveBeenCalled();
    await runAfter();
    expect(mocks.statelessReset).toHaveBeenCalledWith("ada@example.com", {
      redirectTo: "https://shop.example/account/set-password",
    });
  });
});
