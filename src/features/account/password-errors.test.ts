import { describe, expect, it } from "vitest";

import { passwordUpdateError } from "./password-errors";

describe("passwordUpdateError (AC-3)", () => {
  it("tells a leaked password from one that breaks the rules", () => {
    expect(passwordUpdateError({ code: "weak_password", status: 422, reasons: ["pwned"] })).toBe(
      "leaked_password",
    );
    expect(passwordUpdateError({ code: "weak_password", status: 422, reasons: ["length"] })).toBe(
      "weak_password",
    );
  });

  it("names a reused password", () => {
    expect(passwordUpdateError({ code: "same_password", status: 422 })).toBe("same_password");
  });

  it("reads a rate limit, and anything else as unavailable", () => {
    expect(passwordUpdateError({ code: "over_request_rate_limit", status: 429 })).toBe(
      "rate_limited",
    );
    expect(passwordUpdateError({ status: 500 })).toBe("unavailable");
    expect(passwordUpdateError({ code: "session_not_found", status: 403 })).toBe("unavailable");
  });
});
