import { describe, expect, it, vi } from "vitest";

// Every cron handler trusts this check alone (AGENTS.md, Cron; spec 0006, AC-15).

const secret = "s".repeat(32);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s".repeat(32) } }));

const { isCronRequest } = await import("./cron-auth");

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/x", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("isCronRequest", () => {
  it("accepts the exact bearer secret", () => {
    expect(isCronRequest(request(`Bearer ${secret}`))).toBe(true);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["a wrong secret of the same length", `Bearer ${"x".repeat(32)}`],
    ["a shorter secret", `Bearer ${secret.slice(1)}`],
    ["a longer secret", `Bearer ${secret}s`],
    ["the secret without the scheme", secret],
    ["another scheme", `Basic ${secret}`],
  ])("refuses %s", (_, header) => {
    expect(isCronRequest(request(header))).toBe(false);
  });

  it("refuses a header with multibyte characters without throwing", () => {
    // Same string length as the real header but more bytes: timingSafeEqual throws on unequal
    // buffer lengths, so the byte length check has to come first.
    const header = `Bearer ${"é".repeat(32)}`;

    expect(isCronRequest(request(header))).toBe(false);
  });
});
