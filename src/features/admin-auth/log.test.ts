import { describe, expect, it, vi } from "vitest";

import { authEventRecord, hashEmail, requestIp } from "./log";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

describe("auth event records (AC-13)", () => {
  it("prefers the admin id and never carries the email", () => {
    const record = authEventRecord("auth.sign_in.succeeded", {
      adminId: "u1",
      email: "ada@example.com",
      ip: "1.2.3.4",
    });
    expect(record).toEqual({ event: "auth.sign_in.succeeded", adminId: "u1", ip: "1.2.3.4" });
  });

  it("hashes the lower cased email when no id is known", () => {
    const record = authEventRecord("auth.sign_in.failed", {
      email: " Ada@Example.com",
      ip: null,
      reason: "invalid_credentials",
    });
    expect(record).toEqual({
      event: "auth.sign_in.failed",
      emailHash: hashEmail("ada@example.com"),
      ip: null,
      reason: "invalid_credentials",
    });
    expect(JSON.stringify(record)).not.toContain("ada@");
    expect(hashEmail("ada@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("takes the first x-forwarded-for entry as the client IP", () => {
    expect(requestIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(requestIp(new Headers())).toBeNull();
  });
});
