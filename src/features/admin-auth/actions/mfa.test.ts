import { beforeEach, describe, expect, it, vi } from "vitest";

import { brand } from "@/lib/brand/brand";

import type { AdminSession } from "../require-admin";
import { enrollTotp, verifyTotp } from "./mfa";

const mocks = vi.hoisted(() => {
  class NavigationSignal extends Error {}
  return {
    NavigationSignal,
    redirect: vi.fn((url: string) => {
      throw new NavigationSignal(`redirect:${url}`);
    }),
    requireAdminSession: vi.fn(),
    listFactors: vi.fn(),
    unenroll: vi.fn(),
    enroll: vi.fn(),
    challengeAndVerify: vi.fn(),
    signOut: vi.fn(),
    clearAuthCookies: vi.fn(),
    countRecentWrongCodes: vi.fn(),
    factorBusy: false,
    info: vi.fn(),
    warn: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../require-admin", () => ({ requireAdminSession: mocks.requireAdminSession }));
// The locked count reads auth.mfa_challenges (pinned by the stack test); the threshold stays
// real.
vi.mock("../mfa-lockout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mfa-lockout")>()),
  withFactorLock: async (factorId: string, run: (wrongCodes: number) => Promise<unknown>) =>
    mocks.factorBusy
      ? { ok: false, error: "busy" }
      : { ok: true, data: await run(await mocks.countRecentWrongCodes(factorId)) },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signOut: mocks.signOut,
      mfa: {
        listFactors: mocks.listFactors,
        unenroll: mocks.unenroll,
        enroll: mocks.enroll,
        challengeAndVerify: mocks.challengeAndVerify,
      },
    },
  }),
  clearAuthCookies: mocks.clearAuthCookies,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn } }));

const ADMIN_ID = "admin-1";

function session(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    admin: { id: ADMIN_ID, email: "admin@example.com", name: "Ada" },
    aal: "aal1",
    fromResetLink: false,
    ...overrides,
  };
}

const factor = (id: string, status: "verified" | "unverified", createdAt: string) => ({
  id,
  factor_type: "totp",
  status,
  created_at: createdAt,
});

function factorsAre(...all: ReturnType<typeof factor>[]) {
  mocks.listFactors.mockResolvedValue({ data: { all }, error: null });
}

const verified = factor("verified-factor", "verified", "2026-09-01T00:00:00Z");

async function outcome<T>(run: () => Promise<T>): Promise<T | string> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof mocks.NavigationSignal) return error.message;
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminSession.mockResolvedValue(session());
  mocks.countRecentWrongCodes.mockResolvedValue(0);
  mocks.factorBusy = false;
  mocks.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  mocks.unenroll.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.enroll.mockResolvedValue({
    data: { totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABCDEFGHIJKLMNOP" } },
    error: null,
  });
});

describe("enrollTotp", () => {
  it("runs behind the guard, allowing only the password step", async () => {
    factorsAre();

    await enrollTotp();

    expect(mocks.requireAdminSession).toHaveBeenCalledWith({ allowAal1: true });
  });

  // covers: AC-4
  it("returns the QR code and key for a new admin, issued under the store name", async () => {
    factorsAre();

    const result = await enrollTotp();

    expect(result).toEqual({
      ok: true,
      data: { qrCode: "data:image/svg+xml;utf8,<svg/>", secret: "ABCDEFGHIJKLMNOP" },
    });
    expect(mocks.enroll).toHaveBeenCalledWith(
      expect.objectContaining({ factorType: "totp", issuer: brand.name }),
    );
  });

  // covers: AC-4
  it("removes a leftover unverified factor before issuing a new QR code", async () => {
    factorsAre(factor("stale", "unverified", "2026-09-25T09:00:00Z"));

    await enrollTotp();

    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "stale" });
    expect(mocks.unenroll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enroll.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // covers: AC-4 (a reset link session never enrolls a factor)
  it("refuses a reset link session without touching any factor", async () => {
    mocks.requireAdminSession.mockResolvedValue(session({ fromResetLink: true }));

    await expect(enrollTotp()).resolves.toEqual({ ok: false, error: "mfa_not_set_up" });
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("sends an admin who already has a verified factor back to the verify view", async () => {
    factorsAre(verified);

    await expect(outcome(enrollTotp)).resolves.toBe("redirect:/admin/mfa");
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("stops and reports the failure when a leftover factor cannot be removed", async () => {
    factorsAre(factor("stale", "unverified", "2026-09-25T09:00:00Z"));
    mocks.unenroll.mockResolvedValue({ error: { status: 429 } });

    await expect(enrollTotp()).resolves.toEqual({ ok: false, error: "rate_limited" });
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("shows an unexpected rejection from enroll as an outage", async () => {
    factorsAre();
    mocks.enroll.mockResolvedValue({ data: null, error: { status: 422 } });

    await expect(enrollTotp()).resolves.toEqual({ ok: false, error: "unavailable" });
  });

  it("reports a failed factor lookup", async () => {
    mocks.listFactors.mockResolvedValue({ data: null, error: { status: 500 } });

    await expect(enrollTotp()).resolves.toEqual({ ok: false, error: "unavailable" });
  });
});

describe("verifyTotp", () => {
  // covers: AC-2
  it("verifies the code against the admin's verified factor and goes to next", async () => {
    factorsAre(verified);

    await expect(outcome(() => verifyTotp({ code: "123456" }, "/admin/orders"))).resolves.toBe(
      "redirect:/admin/orders",
    );
    expect(mocks.challengeAndVerify).toHaveBeenCalledWith({
      factorId: "verified-factor",
      code: "123456",
    });
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.mfa.succeeded", adminId: ADMIN_ID }),
      "auth.mfa.succeeded",
    );
  });

  it("accepts a code typed with a space, as authenticator apps show it", async () => {
    factorsAre(verified);

    await outcome(() => verifyTotp({ code: "123 456" }, undefined));

    expect(mocks.challengeAndVerify).toHaveBeenCalledWith(
      expect.objectContaining({ code: "123456" }),
    );
  });

  // Value sourcing: a factor id is never taken from the browser.
  it("ignores a factor id sent with the code", async () => {
    factorsAre(verified);

    await outcome(() => verifyTotp({ code: "123456", factorId: "attacker-factor" }, undefined));

    expect(mocks.challengeAndVerify).toHaveBeenCalledWith({
      factorId: "verified-factor",
      code: "123456",
    });
  });

  // covers: AC-12
  it("goes to /admin when next points off site", async () => {
    factorsAre(verified);

    await expect(
      outcome(() => verifyTotp({ code: "123456" }, "https://evil.example/admin")),
    ).resolves.toBe("redirect:/admin");
  });

  // covers: AC-4
  it("enrolls the newest pending factor with the first correct code and logs both events", async () => {
    factorsAre(
      factor("older", "unverified", "2026-09-25T09:00:00Z"),
      factor("newer", "unverified", "2026-09-25T10:00:00Z"),
    );

    await expect(outcome(() => verifyTotp({ code: "123456" }, undefined))).resolves.toBe(
      "redirect:/admin",
    );
    expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: "newer", code: "123456" });
    const events = mocks.info.mock.calls.map((call: unknown[]) => call[1]);
    expect(events).toEqual(["auth.mfa.enrolled", "auth.mfa.succeeded"]);
  });

  it("skips the check for a session that already reached aal2", async () => {
    mocks.requireAdminSession.mockResolvedValue(session({ aal: "aal2" }));

    await expect(outcome(() => verifyTotp({ code: "123456" }, "/admin/orders"))).resolves.toBe(
      "redirect:/admin/orders",
    );
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("returns a field error for a code that is not 6 digits", async () => {
    await expect(verifyTotp({ code: "12345" }, undefined)).resolves.toEqual({
      ok: false,
      error: { fields: { code: ["Enter the 6 digit code"] } },
    });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  // covers: AC-4
  it("answers a wrong code with invalid_code and logs it without the code", async () => {
    factorsAre(verified);
    mocks.challengeAndVerify.mockResolvedValue({
      data: null,
      error: { code: "mfa_verification_failed", status: 422 },
    });

    await expect(verifyTotp({ code: "654321" }, undefined)).resolves.toEqual({
      ok: false,
      error: { form: "invalid_code" },
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.mfa.failed", adminId: ADMIN_ID }),
      "auth.mfa.failed",
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("654321");
  });

  it("reports a rate limit on the check without counting it as a wrong code", async () => {
    factorsAre(verified);
    mocks.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 429 } });

    await expect(verifyTotp({ code: "123456" }, undefined)).resolves.toEqual({
      ok: false,
      error: { form: "rate_limited" },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("refuses when the admin has no factor at all", async () => {
    factorsAre();

    await expect(verifyTotp({ code: "123456" }, undefined)).resolves.toEqual({
      ok: false,
      error: { form: "mfa_not_set_up" },
    });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  // covers: AC-4 (a reset link session may only verify an existing factor)
  it("refuses to enroll a pending factor from a reset link session", async () => {
    mocks.requireAdminSession.mockResolvedValue(session({ fromResetLink: true }));
    factorsAre(factor("pending", "unverified", "2026-09-25T10:00:00Z"));

    await expect(verifyTotp({ code: "123456" }, undefined)).resolves.toEqual({
      ok: false,
      error: { form: "mfa_not_set_up" },
    });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("lets a reset link session verify a factor that already exists", async () => {
    mocks.requireAdminSession.mockResolvedValue(session({ fromResetLink: true }));
    factorsAre(verified);

    await expect(
      outcome(() => verifyTotp({ code: "123456" }, "/admin/reset-password")),
    ).resolves.toBe("redirect:/admin/reset-password");
  });

  // covers: AC-16
  it("after 5 wrong codes, ends the session and sends the admin to sign in without checking the code", async () => {
    factorsAre(verified);
    mocks.countRecentWrongCodes.mockResolvedValue(5);

    await expect(outcome(() => verifyTotp({ code: "123456" }, undefined))).resolves.toBe(
      "redirect:/admin/sign-in?reason=too_many_codes",
    );
    expect(mocks.countRecentWrongCodes).toHaveBeenCalledWith("verified-factor");
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.mfa.locked", adminId: ADMIN_ID }),
      "auth.mfa.locked",
    );
  });

  // covers: AC-16
  it("still checks the code after 4 wrong ones", async () => {
    factorsAre(verified);
    mocks.countRecentWrongCodes.mockResolvedValue(4);

    await outcome(() => verifyTotp({ code: "123456" }, undefined));

    expect(mocks.challengeAndVerify).toHaveBeenCalledOnce();
  });

  it("asks the admin to wait when a code for the same factor is still being checked", async () => {
    factorsAre(verified);
    mocks.factorBusy = true;

    await expect(verifyTotp({ code: "123456" }, undefined)).resolves.toEqual({
      ok: false,
      error: { form: "rate_limited" },
    });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
