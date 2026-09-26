import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  signOutCall: vi.fn(),
  clearAuthCookies: vi.fn(),
  info: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: mocks.getClaims, signOut: mocks.signOutCall },
  }),
  clearAuthCookies: mocks.clearAuthCookies,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn() } }));

const { signOutRequest } = await import("./sign-out");
const route = await import("../../../app/admin/sign-out/route");

const url = "https://shop.example/admin/sign-out";

function post(headers: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.7", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } } });
  mocks.signOutCall.mockResolvedValue({ error: null });
});

// covers: spec 0005 AC-20 (and spec 0004 AC-8)
describe("POST /admin/sign-out", () => {
  it("ends the session on this device and answers 303 to sign in, never cached", async () => {
    const response = await signOutRequest(post({ origin: "https://shop.example" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://shop.example/admin/sign-in?reason=signed_out",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.signOutCall).toHaveBeenCalledWith({ scope: "local" });
  });

  it("logs the admin id from the session claims", async () => {
    await signOutRequest(post({ origin: "https://shop.example" }));

    expect(mocks.info).toHaveBeenCalledWith(
      { event: "auth.sign_out", adminId: "admin-1", ip: "203.0.113.7" },
      "auth.sign_out",
    );
  });

  it("still signs out when there is no session to read", async () => {
    mocks.getClaims.mockResolvedValue({ data: null });

    const response = await signOutRequest(post({ origin: "https://shop.example" }));

    expect(response.status).toBe(303);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "auth.sign_out", ip: "203.0.113.7" },
      "auth.sign_out",
    );
  });

  it("clears the auth cookies by hand when the Auth server call fails", async () => {
    mocks.signOutCall.mockResolvedValue({ error: { status: 503 } });

    await signOutRequest(post({ origin: "https://shop.example" }));

    expect(mocks.clearAuthCookies).toHaveBeenCalledOnce();
  });

  it.each([
    ["a foreign origin", { origin: "https://evil.example" }],
    ["no origin", {}],
  ])("refuses %s with 403 and signs nobody out", async (_, headers) => {
    const response = await signOutRequest(post(headers));

    expect(response.status).toBe(403);
    expect(mocks.signOutCall).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("exports only POST, so a GET can never sign out", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});
