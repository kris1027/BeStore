import { describe, expect, it, vi } from "vitest";

import { config } from "../../../proxy";
import { ADMIN_SESSION_MAX_AGE_SECONDS, type AdminRow } from "./access";
import {
  type AdminGateInput,
  decideAdminGate,
  decideProxy,
  needsAdminGate,
  type ProxyInput,
} from "./proxy-decision";

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

  it("never touches sign out, whatever the session state (spec 0005, AC-20)", () => {
    const late = at(ADMIN_SESSION_MAX_AGE_SECONDS + 1);
    for (const overrides of [{ claims: null }, { nowMs: late }, {}]) {
      expect(decideProxy(input({ pathname: "/admin/sign-out", ...overrides }))).toEqual({
        kind: "continue",
      });
    }
  });
});

const adminRow: AdminRow = {
  id: "admin-1",
  email: "ada@example.com",
  name: "Ada",
  disabledAt: null,
};

function gate(overrides: Partial<AdminGateInput> = {}): AdminGateInput {
  return {
    pathname: "/admin/orders",
    search: "?page=2",
    method: "GET",
    isServerAction: false,
    claims: { sub: "admin-1", aal: "aal2", amr: fresh.amr },
    nowMs: at(60),
    ...overrides,
  };
}

// covers: spec 0005 AC-19
describe("needsAdminGate", () => {
  it("gates every GET and HEAD to an admin page", () => {
    expect(needsAdminGate(gate())).toBe(true);
    expect(needsAdminGate(gate({ pathname: "/admin" }))).toBe(true);
    expect(needsAdminGate(gate({ pathname: "/admin/mfa" }))).toBe(true);
    expect(needsAdminGate(gate({ method: "HEAD" }))).toBe(true);
  });

  it("skips sign in, forgot password and sign out", () => {
    for (const pathname of ["/admin/sign-in", "/admin/forgot-password", "/admin/sign-out"]) {
      expect(needsAdminGate(gate({ pathname }))).toBe(false);
    }
  });

  it("skips server actions and other POSTs, which answer for themselves", () => {
    expect(needsAdminGate(gate({ method: "POST", isServerAction: true }))).toBe(false);
    expect(needsAdminGate(gate({ method: "POST" }))).toBe(false);
  });

  it("skips paths outside /admin", () => {
    expect(needsAdminGate(gate({ pathname: "/auth/confirm" }))).toBe(false);
    expect(needsAdminGate(gate({ pathname: "/administrator" }))).toBe(false);
  });
});

// covers: spec 0005 AC-19
describe("decideAdminGate", () => {
  it("lets an active aal2 admin through", () => {
    expect(decideAdminGate({ ...gate(), adminRow })).toEqual({ kind: "continue" });
  });

  it("answers a user with no admin row with a 404", () => {
    expect(decideAdminGate({ ...gate(), adminRow: null })).toEqual({ kind: "not-found" });
  });

  it("answers a disabled admin with a 404", () => {
    const disabled = { ...adminRow, disabledAt: new Date(at(0)) };
    expect(decideAdminGate({ ...gate(), adminRow: disabled })).toEqual({ kind: "not-found" });
  });

  it("answers a non admin with a 404 on the MFA page too", () => {
    expect(decideAdminGate({ ...gate({ pathname: "/admin/mfa" }), adminRow: null })).toEqual({
      kind: "not-found",
    });
  });

  it("sends an aal1 admin to the MFA step, keeping the path and query as next", () => {
    const aal1 = gate({ claims: { sub: "admin-1", aal: "aal1", amr: fresh.amr } });
    expect(decideAdminGate({ ...aal1, adminRow })).toEqual({
      kind: "redirect",
      to: "/admin/mfa?next=%2Fadmin%2Forders%3Fpage%3D2",
    });
  });

  it("lets an aal1 admin open the MFA page itself", () => {
    const aal1 = gate({ pathname: "/admin/mfa", claims: { sub: "admin-1", aal: "aal1" } });
    expect(
      decideAdminGate({ ...aal1, claims: { ...aal1.claims, amr: fresh.amr }, adminRow }),
    ).toEqual({
      kind: "continue",
    });
  });

  it("never grants: a session without a subject goes on to the page's own guard", () => {
    expect(decideAdminGate({ ...gate({ claims: { amr: fresh.amr } }), adminRow: null })).toEqual({
      kind: "continue",
    });
  });
});

describe("proxy matcher", () => {
  it("runs only on admin and auth routes, so the storefront never calls Supabase", () => {
    expect(config.matcher).toEqual(["/admin/:path*", "/auth/:path*"]);
  });
});
