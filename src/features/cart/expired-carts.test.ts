import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0005, AC-16: the cron's bearer check, without a database. The db suite
// (tests/db/expired-carts.db.test.ts) covers the deletes themselves.

const secret = "s".repeat(32);

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), info: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { $executeRaw: mocks.executeRaw } }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn() } }));

const { EXPIRED_CART_BATCH, expiredCartsRequest } = await import("./expired-carts");

beforeEach(() => vi.clearAllMocks());

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/expired-carts", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("expiredCartsRequest", () => {
  // Headers of a different length must be refused before timingSafeEqual, which throws on them.
  it.each([
    ["an empty header", ""],
    ["a lowercase scheme", `bearer ${secret}`],
    ["a trailing character", `Bearer ${secret}x`],
    ["a longer secret", `Bearer ${secret}${secret}`],
    ["a one byte difference", `Bearer ${"s".repeat(31)}t`],
    ["a Latin 1 header, same length in characters but longer in bytes", `Bearer ${"é".repeat(32)}`],
  ])("answers %s with 401, never touching the database", async (_, header) => {
    const response = await expiredCartsRequest(request(header));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("deletes in batches until one deletes nothing, and reports the total", async () => {
    mocks.executeRaw
      .mockResolvedValueOnce(EXPIRED_CART_BATCH)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0);

    const response = await expiredCartsRequest(request(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: EXPIRED_CART_BATCH + 3 });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "cron.expired_carts", deleted: EXPIRED_CART_BATCH + 3 },
      "cron.expired_carts",
    );
  });
});
