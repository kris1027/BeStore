import { describe, expect, it } from "vitest";

import { classifyAuthError } from "./auth-errors";

describe("classifyAuthError", () => {
  it("maps Supabase rate limits", () => {
    expect(classifyAuthError({ code: "over_request_rate_limit", status: 429 })).toBe(
      "rate_limited",
    );
    expect(classifyAuthError({ code: "over_email_send_rate_limit", status: 400 })).toBe(
      "rate_limited",
    );
    expect(classifyAuthError({ status: 429 })).toBe("rate_limited");
  });

  it("maps outages and network errors", () => {
    expect(classifyAuthError({ status: 500 })).toBe("unavailable");
    expect(classifyAuthError({ status: 0 })).toBe("unavailable");
    expect(classifyAuthError({})).toBe("unavailable");
  });

  it("treats other client errors as a plain rejection", () => {
    expect(classifyAuthError({ code: "invalid_credentials", status: 400 })).toBe("rejected");
    expect(classifyAuthError({ code: "mfa_verification_failed", status: 422 })).toBe("rejected");
  });
});
