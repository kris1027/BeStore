import { beforeEach, describe, expect, it, vi } from "vitest";

import { mfaViewFor } from "./mfa-view";
import type { AdminSession } from "./require-admin";

const { listFactors } = vi.hoisted(() => ({ listFactors: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { mfa: { listFactors } } }),
}));

const session = (fromResetLink: boolean): AdminSession => ({
  admin: { id: "admin-1", email: "admin@example.com", name: "Ada" },
  aal: "aal1",
  fromResetLink,
});

const factor = (id: string, status: "verified" | "unverified") => ({
  id,
  factor_type: "totp",
  status,
  created_at: "2026-09-25T10:00:00Z",
});

function factorsAre(...all: ReturnType<typeof factor>[]) {
  listFactors.mockResolvedValue({ data: { all }, error: null });
}

beforeEach(() => {
  listFactors.mockReset();
});

describe("mfaViewFor", () => {
  // covers: AC-2
  it("shows the verify view to an admin with a verified factor", async () => {
    factorsAre(factor("v1", "verified"));

    await expect(mfaViewFor(session(false))).resolves.toBe("verify");
  });

  it("shows the verify view to a reset link session whose admin has a factor", async () => {
    factorsAre(factor("v1", "verified"));

    await expect(mfaViewFor(session(true))).resolves.toBe("verify");
  });

  // covers: AC-4
  it("offers setup to a new admin with no factor", async () => {
    factorsAre();

    await expect(mfaViewFor(session(false))).resolves.toBe("setup");
  });

  // covers: AC-4 (a reload after scanning keeps the code form)
  it("keeps the code form for a factor enrolled but not verified yet", async () => {
    factorsAre(factor("u1", "unverified"));

    await expect(mfaViewFor(session(false))).resolves.toBe("setup-pending");
  });

  // covers: AC-4 (a reset link session never enrolls a factor)
  it("tells a reset link session with no verified factor to contact the store owner", async () => {
    factorsAre(factor("u1", "unverified"));

    await expect(mfaViewFor(session(true))).resolves.toBe("not-set-up");
  });

  it("reports a rate limit from the Auth server", async () => {
    listFactors.mockResolvedValue({ data: null, error: { status: 429 } });

    await expect(mfaViewFor(session(false))).resolves.toBe("rate_limited");
  });

  it("reports any other Auth failure as unavailable, never as setup", async () => {
    listFactors.mockResolvedValue({ data: null, error: { status: 400 } });

    await expect(mfaViewFor(session(false))).resolves.toBe("unavailable");
  });
});
