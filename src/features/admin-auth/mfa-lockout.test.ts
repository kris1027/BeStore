import { beforeEach, describe, expect, it, vi } from "vitest";

import { countRecentWrongCodes, isLockedOut, MAX_WRONG_CODES, withFactorLock } from "./mfa-lockout";

const { queryRaw, executeRaw, transaction } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: queryRaw, $transaction: transaction } }));

// covers: AC-16 (5 wrong codes in 15 minutes lock the MFA step). The SQL itself is pinned
// against the local stack in tests/stack/mfa-challenges.stack.test.ts.
describe("isLockedOut", () => {
  it("allows a code while fewer than 5 wrong codes are counted", () => {
    expect(isLockedOut(0)).toBe(false);
    expect(isLockedOut(MAX_WRONG_CODES - 1)).toBe(false);
  });

  it("locks out from the 5th wrong code on", () => {
    expect(MAX_WRONG_CODES).toBe(5);
    expect(isLockedOut(5)).toBe(true);
    expect(isLockedOut(9)).toBe(true);
  });
});

describe("countRecentWrongCodes", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("returns the count from the query", async () => {
    queryRaw.mockResolvedValue([{ count: 3 }]);

    await expect(countRecentWrongCodes("factor-1")).resolves.toBe(3);
  });

  it("returns 0 when the query yields no row", async () => {
    queryRaw.mockResolvedValue([]);

    await expect(countRecentWrongCodes("factor-1")).resolves.toBe(0);
  });

  it("passes the factor id as a bound parameter, never spliced into the SQL", async () => {
    queryRaw.mockResolvedValue([{ count: 0 }]);

    await countRecentWrongCodes("factor-1'; DROP TABLE x; --");

    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).not.toContain("DROP TABLE");
    expect(values).toContain("factor-1'; DROP TABLE x; --");
  });
});

describe("withFactorLock", () => {
  const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw };

  beforeEach(() => {
    queryRaw.mockReset();
    executeRaw.mockReset();
    transaction.mockReset();
    transaction.mockImplementation((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  });

  it("takes the factor's lock before counting, and counts inside the same transaction", async () => {
    const order: string[] = [];
    executeRaw.mockImplementation(async () => order.push("lock"));
    queryRaw.mockImplementation(async () => {
      order.push("count");
      return [{ count: 2 }];
    });

    const result = await withFactorLock("factor-1", async (wrongCodes) => {
      order.push("run");
      return wrongCodes;
    });

    expect(result).toBe(2);
    expect(order).toEqual(["lock", "count", "run"]);
    const [strings, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("pg_advisory_xact_lock");
    expect(values).toEqual(["factor-1"]);
  });
});
