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
vi.mock("@/features/account/proxy", () => ({ accountProxy: vi.fn() }));

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

  it("leaves the sign in page and paths outside /admin open", () => {
    for (const pathname of ["/admin/sign-in", "/auth/confirm"]) {
      expect(decideProxy(input({ pathname, claims: null }))).toEqual({ kind: "continue" });
    }
  });

  // spec 0019, AC-4: the removed pages are ordinary admin paths now.
  it("sends a signed out visitor from a removed auth page to sign in", () => {
    for (const pathname of ["/admin/mfa", "/admin/forgot-password", "/admin/reset-password"]) {
      expect(decideProxy(input({ pathname, search: "", claims: null }))).toEqual({
        kind: "redirect",
        to: `/admin/sign-in?next=${encodeURIComponent(pathname)}`,
      });
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
    claims: { sub: "admin-1", amr: fresh.amr },
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

  it("skips sign in and sign out", () => {
    for (const pathname of ["/admin/sign-in", "/admin/sign-out"]) {
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
  it("lets an active admin with a password session through", () => {
    expect(decideAdminGate({ ...gate(), adminRow })).toEqual({ kind: "continue" });
  });

  it("answers a user with no admin row with a 404", () => {
    expect(decideAdminGate({ ...gate(), adminRow: null })).toEqual({ kind: "not-found" });
  });

  it("answers a disabled admin with a 404", () => {
    const disabled = { ...adminRow, disabledAt: new Date(at(0)) };
    expect(decideAdminGate({ ...gate(), adminRow: disabled })).toEqual({ kind: "not-found" });
  });

  it("answers a non admin with a 404 on a removed auth page too (spec 0019, AC-4)", () => {
    expect(decideAdminGate({ ...gate({ pathname: "/admin/mfa" }), adminRow: null })).toEqual({
      kind: "not-found",
    });
  });

  // spec 0019, AC-2: a real redirect, not the 200 a page's own redirect() streams.
  it("sends an admin whose session no password opened to sign in, keeping next", () => {
    const recovery = gate({
      claims: { sub: "admin-1", amr: [{ method: "recovery", timestamp: signedInAt }] },
    });
    expect(decideAdminGate({ ...recovery, adminRow })).toEqual({
      kind: "redirect",
      to: "/admin/sign-in?next=%2Fadmin%2Forders%3Fpage%3D2",
    });
  });

  it("never grants: a session without a subject is sent to sign in", () => {
    expect(decideAdminGate({ ...gate({ claims: { amr: fresh.amr } }), adminRow: null })).toEqual({
      kind: "redirect",
      to: "/admin/sign-in?next=%2Fadmin%2Forders%3Fpage%3D2",
    });
  });
});

describe("proxy matcher", () => {
  // spec 0012, AC-22: the account pages and checkout join; catalog pages never call Supabase.
  // spec 0019, AC-4: /auth has no pages left.
  it("runs only on admin, account and checkout routes", () => {
    expect(config.matcher).toEqual(["/admin/:path*", "/account/:path*", "/checkout/:path*"]);
  });
});
