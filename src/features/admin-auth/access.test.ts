import { describe, expect, it } from "vitest";

import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  type AccessInput,
  decideAdminAccess,
  isResetSession,
  isSessionExpired,
  sessionStartedAtSeconds,
} from "./access";

const signedInAt = 1_790_000_000;
const now = (secondsAfterSignIn: number) => (signedInAt + secondsAfterSignIn) * 1000;
const row = { id: "u1", email: "a@example.com", name: "Ada", disabledAt: null };

function input(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    userId: "u1",
    aal: "aal2",
    amr: [
      { method: "password", timestamp: signedInAt },
      { method: "totp", timestamp: signedInAt + 30 },
    ],
    adminRow: row,
    nowMs: now(60),
    ...overrides,
  };
}

describe("decideAdminAccess", () => {
  it("allows an active admin at aal2", () => {
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

  it("404s a non admin even at aal1, before any hint of the MFA step", () => {
    expect(decideAdminAccess(input({ aal: "aal1", adminRow: null })).kind).toBe("not-found");
  });

  it("sends aal1 to the MFA step unless the caller allows aal1", () => {
    expect(decideAdminAccess(input({ aal: "aal1" }))).toEqual({ kind: "mfa" });
    expect(decideAdminAccess(input({ aal: null }))).toEqual({ kind: "mfa" });
    expect(decideAdminAccess(input({ aal: "aal1", allowAal1: true })).kind).toBe("allow");
  });
});

describe("session start", () => {
  it("is the earliest amr timestamp", () => {
    expect(sessionStartedAtSeconds(input().amr)).toBe(signedInAt);
  });

  it("does not move when TOTP is verified again later", () => {
    const reverified = [
      { method: "password", timestamp: signedInAt },
      { method: "totp", timestamp: signedInAt + 40_000 },
    ];
    expect(sessionStartedAtSeconds(reverified)).toBe(signedInAt);
    expect(isSessionExpired(reverified, now(ADMIN_SESSION_MAX_AGE_SECONDS + 1))).toBe(true);
  });

  it("fails closed when amr has no timestamps", () => {
    expect(sessionStartedAtSeconds(["password"])).toBeNull();
    expect(sessionStartedAtSeconds(undefined)).toBeNull();
    expect(isSessionExpired(["password"], now(1))).toBe(true);
    expect(decideAdminAccess(input({ amr: [] }))).toEqual({ kind: "sign-in", reason: "expired" });
  });
});

describe("isResetSession", () => {
  it("spots recovery and otp sessions in either amr format", () => {
    expect(isResetSession([{ method: "recovery", timestamp: 1 }])).toBe(true);
    expect(isResetSession([{ method: "otp", timestamp: 1 }])).toBe(true);
    expect(isResetSession(["otp"])).toBe(true);
    expect(isResetSession(input().amr)).toBe(false);
    expect(isResetSession(null)).toBe(false);
  });
});
