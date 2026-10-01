import { describe, expect, it } from "vitest";

import { emailDisplay } from "./email-display";

const purgedAt = new Date("2026-09-01T04:00:00Z");

describe("emailDisplay", () => {
  it("shows the email of an order that was not purged", () => {
    expect(emailDisplay({ email: "ada@example.com", piiPurgedAt: null })).toEqual({
      kind: "email",
      email: "ada@example.com",
    });
  });

  it("says the data was removed once the purge ran", () => {
    expect(emailDisplay({ email: null, piiPurgedAt: purgedAt })).toEqual({
      kind: "purged",
      purgedAt,
    });
  });

  // The CHECK on orders makes this unreachable through the database, so it is proved here.
  it("flags a null email on an order that was never purged as missing, not as empty", () => {
    expect(emailDisplay({ email: null, piiPurgedAt: null })).toEqual({ kind: "missing" });
  });

  it("trusts the purge stamp over a leftover email", () => {
    expect(emailDisplay({ email: "ada@example.com", piiPurgedAt: purgedAt }).kind).toBe("purged");
  });
});
