import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { factorToVerify, loadTotpFactors, type TotpFactors } from "./factors";

vi.mock("server-only", () => ({}));

type Factor = {
  readonly id: string;
  readonly factor_type: string;
  readonly status: string;
  readonly created_at: string;
};

function clientListing(result: { data: { all: Factor[] } | null; error: unknown }) {
  return {
    auth: { mfa: { listFactors: vi.fn().mockResolvedValue(result) } },
  } as unknown as SupabaseClient;
}

const totp = (id: string, status: string, createdAt = "2026-09-25T10:00:00Z"): Factor => ({
  id,
  factor_type: "totp",
  status,
  created_at: createdAt,
});

describe("loadTotpFactors", () => {
  it("splits TOTP factors into the verified one and the unverified ones", async () => {
    const client = clientListing({
      data: { all: [totp("v1", "verified"), totp("u1", "unverified", "2026-09-25T11:00:00Z")] },
      error: null,
    });

    await expect(loadTotpFactors(client)).resolves.toEqual({
      ok: true,
      factors: {
        verified: { id: "v1" },
        unverified: [{ id: "u1", createdAt: "2026-09-25T11:00:00Z" }],
      },
    });
  });

  it("ignores factors that are not TOTP", async () => {
    const client = clientListing({
      data: {
        all: [
          {
            id: "p1",
            factor_type: "phone",
            status: "verified",
            created_at: "2026-09-25T10:00:00Z",
          },
        ],
      },
      error: null,
    });

    await expect(loadTotpFactors(client)).resolves.toEqual({
      ok: true,
      factors: { verified: null, unverified: [] },
    });
  });

  it("reports a rate limit from the Auth server as a failure value", async () => {
    const client = clientListing({ data: null, error: { status: 429 } });

    await expect(loadTotpFactors(client)).resolves.toEqual({ ok: false, failure: "rate_limited" });
  });

  it("reports an outage as unavailable", async () => {
    const client = clientListing({ data: null, error: { status: 503 } });

    await expect(loadTotpFactors(client)).resolves.toEqual({ ok: false, failure: "unavailable" });
  });
});

describe("factorToVerify", () => {
  it("prefers the verified factor over any being enrolled", () => {
    const factors: TotpFactors = {
      verified: { id: "v1" },
      unverified: [{ id: "u1", createdAt: "2026-09-25T11:00:00Z" }],
    };

    expect(factorToVerify(factors)).toBe("v1");
  });

  it("picks the newest unverified factor when none is verified", () => {
    const factors: TotpFactors = {
      verified: null,
      unverified: [
        { id: "old", createdAt: "2026-09-25T09:00:00Z" },
        { id: "new", createdAt: "2026-09-25T11:00:00Z" },
        { id: "mid", createdAt: "2026-09-25T10:00:00Z" },
      ],
    };

    expect(factorToVerify(factors)).toBe("new");
  });

  it("does not reorder the factors it was given", () => {
    const unverified = [
      { id: "old", createdAt: "2026-09-25T09:00:00Z" },
      { id: "new", createdAt: "2026-09-25T11:00:00Z" },
    ];

    factorToVerify({ verified: null, unverified });

    expect(unverified.map((factor) => factor.id)).toEqual(["old", "new"]);
  });

  it("returns null when there is no factor at all", () => {
    expect(factorToVerify({ verified: null, unverified: [] })).toBeNull();
  });
});
