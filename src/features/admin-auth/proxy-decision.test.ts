import { describe, expect, it, vi } from "vitest";

import { config } from "../../../proxy";
import { ADMIN_SESSION_MAX_AGE_SECONDS } from "./access";
import { decideProxy, type ProxyInput } from "./proxy-decision";

// The matcher is all this test reads from proxy.ts; its handler needs the full env.
vi.mock("@/features/admin-auth/proxy", () => ({ adminAuthProxy: vi.fn() }));

const signedInAt = 1_790_000_000;
const fresh = { amr: [{ method: "password", timestamp: signedInAt }] };
const at = (seconds: number) => (signedInAt + seconds) * 1000;

function input(overrides: Partial<ProxyInput> = {}): ProxyInput {
  return {
    pathname: "/admin/orders",
    search: "?page=2",
    isServerAction: false,
    claims: fresh,
    nowMs: at(60),
    ...overrides,
  };
}

describe("decideProxy", () => {
  it("lets a live session through", () => {
    expect(decideProxy(input())).toEqual({ kind: "continue" });
  });

  it("redirects a signed out visitor to sign in with next (AC-1)", () => {
    expect(decideProxy(input({ claims: null }))).toEqual({
      kind: "redirect",
      to: "/admin/sign-in?next=%2Fadmin%2Forders%3Fpage%3D2",
    });
  });

  it("leaves the public auth pages and /auth open", () => {
    for (const pathname of ["/admin/sign-in", "/admin/forgot-password", "/auth/confirm"]) {
      expect(decideProxy(input({ pathname, claims: null }))).toEqual({ kind: "continue" });
    }
  });

  it("never redirects a server action request", () => {
    expect(decideProxy(input({ claims: null, isServerAction: true }))).toEqual({
      kind: "continue",
    });
  });

  it("keeps a session at exactly 12 hours", () => {
    expect(decideProxy(input({ nowMs: at(ADMIN_SESSION_MAX_AGE_SECONDS) }))).toEqual({
      kind: "continue",
    });
  });

  it("ends a session past 12 hours and redirects with the expired reason (AC-7)", () => {
    expect(decideProxy(input({ nowMs: at(ADMIN_SESSION_MAX_AGE_SECONDS + 1) }))).toEqual({
      kind: "expire",
      to: "/admin/sign-in?reason=expired",
    });
  });

  it("ends an expired session without redirecting an action or a public page", () => {
    const late = at(ADMIN_SESSION_MAX_AGE_SECONDS + 1);
    expect(decideProxy(input({ nowMs: late, isServerAction: true }))).toEqual({
      kind: "expire",
      to: null,
    });
    expect(decideProxy(input({ nowMs: late, pathname: "/admin/sign-in" }))).toEqual({
      kind: "expire",
      to: null,
    });
  });
});

describe("proxy matcher", () => {
  it("runs only on admin and auth routes, so the storefront never calls Supabase", () => {
    expect(config.matcher).toEqual(["/admin/:path*", "/auth/:path*"]);
  });
});
