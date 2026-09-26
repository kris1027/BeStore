import { beforeEach, describe, expect, it, vi } from "vitest";

import { signOut } from "./sign-out";

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string, type?: string) => {
      throw new NavigationSignal(`redirect:${type ?? "default"}:${url}`);
    }),
    getClaims: vi.fn(),
    signOutCall: vi.fn(),
    clearAuthCookies: vi.fn(),
    info: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  RedirectType: { push: "push", replace: "replace" },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: mocks.getClaims, signOut: mocks.signOutCall },
  }),
  clearAuthCookies: mocks.clearAuthCookies,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn() } }));

async function outcome(): Promise<string> {
  try {
    await signOut();
    return "returned";
  } catch (error) {
    if (error instanceof mocks.NavigationSignal) return error.message;
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOutCall.mockResolvedValue({ error: null });
});

// covers: AC-8
describe("signOut", () => {
  it("ends the session on this device and replaces the page with sign in", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });

    await expect(outcome()).resolves.toBe("redirect:replace:/admin/sign-in?reason=signed_out");
    expect(mocks.signOutCall).toHaveBeenCalledWith({ scope: "local" });
  });

  it("logs the admin id from the session claims", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });

    await outcome();

    expect(mocks.info).toHaveBeenCalledWith(
      { event: "auth.sign_out", adminId: "admin-1", ip: "203.0.113.7" },
      "auth.sign_out",
    );
  });

  it("still signs out when there is no session to read", async () => {
    mocks.getClaims.mockResolvedValue({ data: null });

    await expect(outcome()).resolves.toBe("redirect:replace:/admin/sign-in?reason=signed_out");
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "auth.sign_out", ip: "203.0.113.7" },
      "auth.sign_out",
    );
  });

  it("clears the auth cookies by hand when the Auth server call fails", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
    mocks.signOutCall.mockResolvedValue({ error: { status: 503 } });

    await expect(outcome()).resolves.toMatch(/sign-in\?reason=signed_out$/);
    expect(mocks.clearAuthCookies).toHaveBeenCalledOnce();
  });
});
