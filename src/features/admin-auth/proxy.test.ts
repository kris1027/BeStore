import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  signOut: vi.fn(),
  findUnique: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: mocks.getClaims, signOut: mocks.signOut } }),
}));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn } }));

const { adminAuthProxy } = await import("./proxy");

const now = Math.floor(Date.now() / 1000);
const amr = [{ method: "password", timestamp: now - 60 }];
const adminRow = { id: "admin-1", email: "ada@example.com", name: "Ada", disabledAt: null };

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`https://shop.example${path}`, {
    method: init.method ?? "GET",
    headers: { "x-forwarded-for": "203.0.113.7", ...init.headers },
  });
}

function signedIn(aal: "aal1" | "aal2") {
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "admin-1", aal, amr } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(adminRow);
  signedIn("aal2");
});

// covers: spec 0005 AC-19
describe("adminAuthProxy admin gate", () => {
  it("lets an active admin through untouched, never cached", async () => {
    const response = await adminAuthProxy(request("/admin/orders"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rewrites a user with no admin row to an unmatched path, so the 404 is real", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await adminAuthProxy(request("/admin"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://shop.example/admin/__denied",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "auth.access.denied", adminId: "admin-1", ip: "203.0.113.7" },
      "auth.access.denied",
    );
  });

  it("rewrites a disabled admin, even for an rsc request", async () => {
    mocks.findUnique.mockResolvedValue({ ...adminRow, disabledAt: new Date() });

    const response = await adminAuthProxy(request("/admin/orders", { headers: { rsc: "1" } }));

    expect(response.headers.get("x-middleware-rewrite")).toMatch(/\/admin\/__denied$/);
  });

  it("redirects an aal1 session to the MFA step with the requested path", async () => {
    signedIn("aal1");

    const response = await adminAuthProxy(request("/admin/orders?page=2"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://shop.example/admin/mfa?next=%2Fadmin%2Forders%3Fpage%3D2",
    );
  });

  it("lets an aal1 session open the MFA page", async () => {
    signedIn("aal1");

    const response = await adminAuthProxy(request("/admin/mfa"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("skips the lookup for a server action and for sign out", async () => {
    await adminAuthProxy(
      request("/admin/orders", { method: "POST", headers: { "next-action": "abc" } }),
    );
    await adminAuthProxy(request("/admin/sign-out", { method: "POST" }));

    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("fails open when the lookup fails, and logs it", async () => {
    mocks.findUnique.mockRejectedValue(new Error("pool exhausted"));

    const response = await adminAuthProxy(request("/admin/orders"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "auth.proxy.lookup_failed", adminId: "admin-1", ip: "203.0.113.7" },
      "auth.proxy.lookup_failed",
    );
  });

  it("still redirects a signed out visitor to sign in without a lookup", async () => {
    mocks.getClaims.mockResolvedValue({ data: null });

    const response = await adminAuthProxy(request("/admin/orders"));

    expect(response.headers.get("location")).toBe(
      "https://shop.example/admin/sign-in?next=%2Fadmin%2Forders",
    );
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
