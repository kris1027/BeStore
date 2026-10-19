import { beforeEach, describe, expect, it, vi } from "vitest";

// spec 0015, AC-14: the failure line goes through the real logger, redaction included, so a
// field name the logger censors (such as `code`, kept for TOTP codes) would hide the SQLSTATE.

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

const { logDashboardQueryFailed, logDashboardSlow } = await import("./log");

beforeEach(() => {
  lines.length = 0;
});

describe("logDashboardQueryFailed", () => {
  it("logs the SQLSTATE in the clear, never the Postgres message", () => {
    const failure = Object.assign(new Error("canceling statement due to lock timeout"), {
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "55P03",
            originalMessage: "canceling statement due to lock timeout",
          },
        },
      },
    });

    logDashboardQueryFailed({ period: "custom", days: 31 }, failure);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 50,
      event: "dashboard.query_failed",
      period: "custom",
      days: 31,
      pgCode: "55P03",
    });
    expect(lines[0]).not.toMatch(/canceling statement|lock timeout|\[redacted\]/);
  });

  it("logs a null pgCode for an error that did not come from Postgres, without its message", () => {
    logDashboardQueryFailed({ period: "7d", days: 7 }, new Error("customer jane@example.com"));

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({ event: "dashboard.query_failed", pgCode: null });
    expect(lines[0]).not.toContain("jane@example.com");
  });
});

describe("logDashboardSlow", () => {
  it("warns with the period, day count and duration", () => {
    logDashboardSlow({ period: "12m", days: 352 }, 1_234);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: 40,
      event: "dashboard.slow",
      period: "12m",
      days: 352,
      durationMs: 1_234,
    });
  });
});
