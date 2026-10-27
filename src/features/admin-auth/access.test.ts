import { describe, expect, it } from "vitest";

import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  type AccessInput,
  decideAdminAccess,
  hasPasswordMethod,
  isSessionExpired,
  sessionStartedAtSeconds,
} from "./access";

const signedInAt = 1_790_000_000;
const now = (secondsAfterSignIn: number) => (signedInAt + secondsAfterSignIn) * 1000;
const row = { id: "u1", email: "a@example.com", name: "Ada", disabledAt: null };

function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    userId: "u1",
    amr: [{ method: "password", timestamp: signedInAt }],
    adminRow: row,
    nowMs: now(60),
    ...overrides,
  };
}

describe("decideAdminAccess", () => {
  it("allows an active admin whose session a password opened", () => {
    expect(decideAdminAccess(input())).toEqual({
      kind: "allow",
      admin: { id: "u1", email: "a@example.com", name: "Ada" },
    });
  });

  it("sends a visitor with no session to sign in", () => {
    expect(decideAdminAccess(input({ userId: null, adminRow: null }))).toEqual({
      kind: "sign-in",
    });
  });

  it("allows exactly 12 hours and expires one second later", () => {
    expect(decideAdminAccess(input({ nowMs: now(ADMIN_SESSION_MAX_AGE_SECONDS) })).kind).toBe(
      "allow",
    );
    expect(decideAdminAccess(input({ nowMs: now(ADMIN_SESSION_MAX_AGE_SECONDS + 1) }))).toEqual({
      kind: "sign-in",
      reason: "expired",
    });
  });

  it("checks age before the admin row, so an expired non admin also signs in again", () => {
    const verdict = decideAdminAccess(
      input({ adminRow: null, nowMs: now(ADMIN_SESSION_MAX_AGE_SECONDS + 1) }),
    );
    expect(verdict).toEqual({ kind: "sign-in", reason: "expired" });
  });

  it("404s a user with no admin row, a disabled admin, or a row for someone else", () => {
    expect(decideAdminAccess(input({ adminRow: null })).kind).toBe("not-found");
    expect(decideAdminAccess(input({ adminRow: { ...row, disabledAt: new Date() } })).kind).toBe(
      "not-found",
    );
    expect(decideAdminAccess(input({ adminRow: { ...row, id: "u2" } })).kind).toBe("not-found");
  });

  // spec 0019, AC-2: an inbox alone never opens the panel.
  it.each([
    ["recovery", [{ method: "recovery", timestamp: signedInAt }]],
    ["otp", [{ method: "otp", timestamp: signedInAt }]],
    ["no method", [{ timestamp: signedInAt }]],
  ])("sends an admin whose session came from %s to sign in", (_label, amr) => {
    expect(decideAdminAccess(input({ amr }))).toEqual({ kind: "sign-in" });
  });

  it("404s a non admin with an email link session, before the sign in method", () => {
    const amr = [{ method: "recovery", timestamp: signedInAt }];
    expect(decideAdminAccess(input({ amr, adminRow: null })).kind).toBe("not-found");
  });
});

describe("hasPasswordMethod", () => {
  it("reads both amr entry shapes", () => {
    expect(hasPasswordMethod([{ method: "password", timestamp: 1 }])).toBe(true);
    expect(hasPasswordMethod(["password"])).toBe(true);
    expect(hasPasswordMethod([{ method: "otp", timestamp: 1 }, "password"])).toBe(true);
  });

  it("is false for email link methods and anything unreadable", () => {
    expect(hasPasswordMethod([{ method: "recovery", timestamp: 1 }])).toBe(false);
    expect(hasPasswordMethod(["otp"])).toBe(false);
    expect(hasPasswordMethod([])).toBe(false);
    expect(hasPasswordMethod(null)).toBe(false);
    expect(hasPasswordMethod({ method: "password" })).toBe(false);
  });
});

describe("session start", () => {
  it("is the earliest amr timestamp", () => {
    const amr = [
      { method: "password", timestamp: signedInAt },
      { method: "otp", timestamp: signedInAt + 40_000 },
    ];
    expect(sessionStartedAtSeconds(amr)).toBe(signedInAt);
    expect(isSessionExpired(amr, now(ADMIN_SESSION_MAX_AGE_SECONDS + 1))).toBe(true);
  });

  it("fails closed when amr has no timestamps", () => {
    expect(sessionStartedAtSeconds(["password"])).toBeNull();
    expect(sessionStartedAtSeconds(undefined)).toBeNull();
    expect(isSessionExpired(["password"], now(1))).toBe(true);
    expect(decideAdminAccess(input({ amr: [] }))).toEqual({ kind: "sign-in", reason: "expired" });
  });
});
