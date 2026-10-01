import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0008: the purge loop and the cron answer, without a database. The db suite
// (tests/db/purge-expired-orders.db.test.ts) covers the SQL, the guards and overlapping runs.

const secret = "s".repeat(32);

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), info: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { $executeRaw: mocks.executeRaw } }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: mocks.error },
}));

const { PURGE_BATCH, purgeExpiredOrders, purgeExpiredOrdersRequest } =
  await import("./purge-expired");

beforeEach(() => vi.clearAllMocks());

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/purge-expired-orders", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

const authorized = () => request(`Bearer ${secret}`);

// Batches that answer these counts in turn, then purge nothing.
function batches(...counts: readonly number[]) {
  const runBatch = vi.fn<(batch: number) => Promise<number>>();
  for (const count of counts) runBatch.mockResolvedValueOnce(count);
  runBatch.mockResolvedValue(0);
  return runBatch;
}

// A Postgres error as @prisma/adapter-pg wraps it, its message quoting the failing row.
function pgError(code: string) {
  return Object.assign(new Error('new row for relation "orders" ada@example.com'), {
    meta: {
      driverAdapterError: {
        cause: { originalCode: code, originalMessage: "Failing row contains (ada@example.com)" },
      },
    },
  });
}

describe("purgeExpiredOrders", () => {
  it("runs the default batch size against the database until a batch purges nothing (AC-1)", async () => {
    mocks.executeRaw.mockResolvedValueOnce(PURGE_BATCH).mockResolvedValueOnce(0);

    expect(await purgeExpiredOrders()).toEqual({ purged: PURGE_BATCH, error: null });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });

  it("passes the batch size to every batch and adds up the counts (AC-4)", async () => {
    const runBatch = batches(3, 3, 1);

    expect(await purgeExpiredOrders({ batch: 3, runBatch, budgetMs: 60_000 })).toEqual({
      purged: 7,
      error: null,
    });
    expect(runBatch.mock.calls).toEqual([[3], [3], [3], [3]]);
  });

  it("answers 0 when nothing is due (AC-5)", async () => {
    const runBatch = batches();

    expect(await purgeExpiredOrders({ runBatch })).toEqual({ purged: 0, error: null });
    expect(runBatch).toHaveBeenCalledOnce();
  });

  it("always runs one batch, then stops once the time budget is spent (AC-4)", async () => {
    const runBatch = batches(2, 2, 2);

    expect(await purgeExpiredOrders({ batch: 2, runBatch, budgetMs: 0 })).toEqual({
      purged: 2,
      error: null,
    });
    expect(runBatch).toHaveBeenCalledOnce();
  });

  it("never throws: a failing first batch comes back as an error beside a count of 0 (AC-6)", async () => {
    const failure = pgError("57014");
    const runBatch = vi.fn().mockRejectedValue(failure);

    expect(await purgeExpiredOrders({ runBatch })).toEqual({ purged: 0, error: failure });
  });

  it("keeps the count of the batches that committed before one failed (AC-6)", async () => {
    const failure = pgError("40P01");
    const runBatch = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(failure);

    expect(await purgeExpiredOrders({ batch: 2, runBatch })).toEqual({
      purged: 4,
      error: failure,
    });
    expect(runBatch).toHaveBeenCalledTimes(3);
  });
});

describe("purgeExpiredOrdersRequest", () => {
  // Headers of a different length must be refused before timingSafeEqual, which throws on them.
  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["a lowercase scheme", `bearer ${secret}`],
    ["the secret without Bearer", secret],
    ["a trailing character", `Bearer ${secret}x`],
    ["a one byte difference", `Bearer ${"s".repeat(31)}t`],
    ["a Latin 1 header, same length in characters but longer in bytes", `Bearer ${"é".repeat(32)}`],
  ])("answers %s with 401, never touching the database (AC-4)", async (_, header) => {
    const runBatch = batches(1);

    const response = await purgeExpiredOrdersRequest(request(header), { runBatch });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(runBatch).not.toHaveBeenCalled();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("answers 200 with the count and logs that count only (AC-4, AC-7)", async () => {
    const response = await purgeExpiredOrdersRequest(authorized(), { runBatch: batches(4, 1) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ purged: 5 });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { event: "cron.purge_expired_orders", purged: 5 },
      "cron.purge_expired_orders",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("answers 500 with the committed count when a batch fails (AC-6)", async () => {
    const runBatch = vi.fn().mockResolvedValueOnce(3).mockRejectedValueOnce(pgError("23514"));

    const response = await purgeExpiredOrdersRequest(authorized(), { runBatch });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "purge_failed", purged: 3 });
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // A Postgres error message or detail can quote the failing row, so neither may leave the server.
  it("logs the error's name and SQLSTATE, never its message or the row it quotes (AC-6, AC-7)", async () => {
    const runBatch = vi.fn().mockRejectedValue(pgError("23514"));

    const response = await purgeExpiredOrdersRequest(authorized(), { runBatch });

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { event: "cron.purge_expired_orders_failed", purged: 0, errorName: "Error", pgCode: "23514" },
      "cron.purge_expired_orders_failed",
    );
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("ada@example.com");
    expect(await response.text()).not.toContain("ada@example.com");
  });

  it("logs a thrown value that is not an Error by its type, with no SQLSTATE (AC-6)", async () => {
    const runBatch = vi.fn().mockRejectedValue("ada@example.com");

    const response = await purgeExpiredOrdersRequest(authorized(), { runBatch });

    expect(response.status).toBe(500);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { event: "cron.purge_expired_orders_failed", purged: 0, errorName: "string", pgCode: null },
      "cron.purge_expired_orders_failed",
    );
  });
});
