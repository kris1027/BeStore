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

const { logDashboardQueryFailed } = await import("./log");

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
});
