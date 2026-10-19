import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// spec 0015: the guards around the SQL. The sums themselves are proven against a real database
// in tests/db/dashboard.db.test.ts.

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/env", () => ({
  env: { STORE_CURRENCY: "EUR", STORE_TIMEZONE: "Europe/Warsaw", STORE_LOCALE: "en" },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: mocks.warn, error: mocks.error },
}));

const { SLOW_DASHBOARD_MS, getSalesDashboard, toSafeNumber } = await import("./queries");
const { parseSalesWindow } = await import("./period");

const window = parseSalesWindow({ period: "7d" }, { y: 2026, m: 10, d: 18 }, "Europe/Warsaw");
const dashboard = { current: {}, previous: {}, buckets: [], bestSellers: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockResolvedValue(dashboard);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toSafeNumber", () => {
  it("reads Postgres bigints and a missing sum as numbers", () => {
    expect(toSafeNumber(null)).toBe(0);
    expect(toSafeNumber(BigInt(12_345))).toBe(12_345);
    expect(toSafeNumber(BigInt(-500))).toBe(-500);
    expect(toSafeNumber(7)).toBe(7);
    expect(toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  // covers: AC-15. A sum past 2^53 would round silently, so it is a broken invariant.
  it("throws rather than round a sum that is not a safe integer", () => {
    expect(() => toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1))).toThrow(
      /not a safe integer/,
    );
  });
});

describe("getSalesDashboard timing", () => {
  it("runs every read in one read only snapshot", async () => {
    await expect(getSalesDashboard(window)).resolves.toBe(dashboard);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      timeout: 15_000,
    });
  });

  it("logs dashboard.slow with the period and duration past the budget", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000 + SLOW_DASHBOARD_MS + 250);

    await getSalesDashboard(window);

    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "dashboard.slow", period: "7d", days: 7, durationMs: SLOW_DASHBOARD_MS + 250 },
      "dashboard.slow",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("stays quiet within the budget", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(SLOW_DASHBOARD_MS);

    await getSalesDashboard(window);

    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("names a custom range as custom in the log", async () => {
    const custom = parseSalesWindow(
      { from: "2026-08-01", to: "2026-08-31" },
      { y: 2026, m: 10, d: 18 },
      "Europe/Warsaw",
    );
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(5_000);

    await getSalesDashboard(custom);

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ period: "custom", days: 31 }),
      "dashboard.slow",
    );
  });
});
