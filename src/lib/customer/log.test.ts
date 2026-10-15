import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "@/lib/logger";

// spec 0012, AC-24: account log lines carry ids, counts and reason codes only, at the right level.

const { lines, sink } = await vi.hoisted(async () => {
  const { Writable } = await import("node:stream");
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, sink };
});

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return { ...actual, logger: actual.createLogger(sink) };
});

const { accountEventRecord, logAccountEvent } = await import("./log");

beforeEach(() => {
  lines.length = 0;
});

describe("accountEventRecord", () => {
  it("keeps only the known fields and drops empty ones", () => {
    expect(accountEventRecord("account.orders_linked", { customerId: "c1", count: 2 })).toEqual({
      event: "account.orders_linked",
      customerId: "c1",
      count: 2,
    });
    expect(accountEventRecord("account.sign_in_failed", { customerId: null, reason: "x" })).toEqual(
      { event: "account.sign_in_failed", reason: "x" },
    );
  });

  it("never passes on a field it does not know, such as an email smuggled in", () => {
    const smuggled = {
      customerId: "c1",
      email: "ada@example.com",
      password: "Secret-1",
      customerName: "Ada Lovelace",
      customer_name: "Ada Lovelace",
    } as never;

    expect(JSON.stringify(accountEventRecord("account.sign_up", smuggled))).not.toMatch(
      /ada@example\.com|Secret-1|Lovelace/,
    );
  });
});

describe("logAccountEvent", () => {
  it("logs conflicts and incomplete deletes as errors, refusals as warnings, the rest as info", () => {
    logAccountEvent("account.email_conflict", { customerId: "c1" });
    logAccountEvent("account.delete_incomplete", { customerId: "c1" });
    logAccountEvent("account.sign_in_failed", { reason: "invalid_credentials" });
    logAccountEvent("account.delete_refused_admin", { customerId: "c1" });
    logAccountEvent("account.sign_in", { customerId: "c1" });

    const levels = lines.map((line) => (JSON.parse(line) as { level: number }).level);
    expect(levels).toEqual([50, 50, 40, 40, 30]);
  });

  it("is redacted by the shared logger even if a secret key ever slipped through", () => {
    const logger = createLogger(sink);
    logger.info({ event: "x", nested: { password: "Secret-1", token_hash: "abc" } }, "x");

    expect(lines.join("")).not.toContain("Secret-1");
    expect(lines.join("")).not.toContain("abc");
  });
});
