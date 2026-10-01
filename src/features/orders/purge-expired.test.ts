import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { PURGE_BATCH, PURGE_TIME_BUDGET_MS, purgeExpiredOrders, purgeExpiredOrdersRequest } =
  await import("./purge-expired");

beforeEach(() => {
  vi.clearAllMocks();
  // Clearing keeps queued answers; each test sets its own batches.
  mocks.executeRaw.mockReset();
});
afterEach(() => vi.restoreAllMocks());

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/purge-expired-orders", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

const authorized = () => request(`Bearer ${secret}`);

// Batches that answer these counts in turn, then purge nothing.
function batches(...counts: readonly number[]) {
  for (const count of counts) mocks.executeRaw.mockResolvedValueOnce(count);
  mocks.executeRaw.mockResolvedValue(0);
}

// Batches that answer these counts in turn, then fail with this error.
function failingAfter(error: unknown, ...counts: readonly number[]) {
  for (const count of counts) mocks.executeRaw.mockResolvedValueOnce(count);
  mocks.executeRaw.mockRejectedValue(error);
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
  it("runs batches of PURGE_BATCH, adding up the counts until a batch purges nothing (AC-1, AC-4)", async () => {
    batches(PURGE_BATCH, PURGE_BATCH, 1);

    expect(await purgeExpiredOrders()).toEqual({ ok: true, purged: 2 * PURGE_BATCH + 1 });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(4);
    // A tagged template call: the strings, then the bound values, the batch size among them.
    for (const [, ...values] of mocks.executeRaw.mock.calls) expect(values).toContain(PURGE_BATCH);
  });

  it("answers 0 when nothing is due (AC-5)", async () => {
    batches();

    expect(await purgeExpiredOrders()).toEqual({ ok: true, purged: 0 });
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
  });

  it("always runs one batch, then stops once the time budget is spent (AC-4)", async () => {
    batches(PURGE_BATCH, PURGE_BATCH);
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(PURGE_TIME_BUDGET_MS);

    expect(await purgeExpiredOrders()).toEqual({ ok: true, purged: PURGE_BATCH });
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
  });

  it("keeps going while the time budget lasts (AC-4)", async () => {
    batches(PURGE_BATCH, PURGE_BATCH);
    vi.spyOn(performance, "now")
      .mockReturnValue(PURGE_TIME_BUDGET_MS - 1)
      .mockReturnValueOnce(0);

    expect(await purgeExpiredOrders()).toEqual({ ok: true, purged: 2 * PURGE_BATCH });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3);
  });

  it("never throws: a failing first batch comes back as an error beside a count of 0 (AC-6)", async () => {
    const failure = pgError("57014");
    failingAfter(failure);

    expect(await purgeExpiredOrders()).toEqual({ ok: false, purged: 0, error: failure });
  });

  it("keeps the count of the batches that committed before one failed (AC-6)", async () => {
    const failure = pgError("40P01");
    failingAfter(failure, PURGE_BATCH, PURGE_BATCH);

    expect(await purgeExpiredOrders()).toEqual({
      ok: false,
      purged: 2 * PURGE_BATCH,
      error: failure,
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3);
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
    batches(1);

    const response = await purgeExpiredOrdersRequest(request(header));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("answers 200 with the count and logs that count only (AC-4, AC-7)", async () => {
    batches(4, 1);

    const response = await purgeExpiredOrdersRequest(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ purged: 5 });
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { event: "cron.purge_expired_orders", purged: 5 },
      "cron.purge_expired_orders",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("answers 500 with the committed count when a batch fails (AC-6)", async () => {
    failingAfter(pgError("23514"), 3);

    const response = await purgeExpiredOrdersRequest(authorized());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "purge_failed", purged: 3 });
    expect(mocks.info).not.toHaveBeenCalled();
  });

  // A Postgres error message or detail can quote the failing row, so neither may leave the server.
  it("logs the error's name and SQLSTATE, never its message or the row it quotes (AC-6, AC-7)", async () => {
    failingAfter(pgError("23514"));

    const response = await purgeExpiredOrdersRequest(authorized());

    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { event: "cron.purge_expired_orders_failed", purged: 0, errorName: "Error", pgCode: "23514" },
      "cron.purge_expired_orders_failed",
    );
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("ada@example.com");
    expect(await response.text()).not.toContain("ada@example.com");
  });

  it("logs a thrown value that is not an Error by its type, with no SQLSTATE (AC-6)", async () => {
    failingAfter("ada@example.com");

    const response = await purgeExpiredOrdersRequest(authorized());

    expect(response.status).toBe(500);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      { event: "cron.purge_expired_orders_failed", purged: 0, errorName: "string", pgCode: null },
      "cron.purge_expired_orders_failed",
    );
  });
});
