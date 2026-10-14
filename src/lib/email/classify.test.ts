import { describe, expect, it } from "vitest";

import { classifySendFailure, stopsSweep } from "./classify";

// spec 0011, AC-9.
describe("classifySendFailure", () => {
  it.each([
    ["validation_error", 422],
    ["validation_error", 400],
    ["invalid_parameter", 422],
    ["missing_required_field", 422],
    ["not_found", 404],
  ])("treats %s (%i) as final", (name, statusCode) => {
    expect(classifySendFailure({ name, statusCode })).toEqual({ kind: "final", errorCode: name });
  });

  it.each([
    ["invalid_api_key", 403],
    ["missing_api_key", 401],
    ["restricted_api_key", 401],
    ["invalid_access", 403],
  ])("treats %s (%i) as a config error that stops the sweep", (name, statusCode) => {
    const verdict = classifySendFailure({ name, statusCode });
    expect(verdict).toEqual({ kind: "config", errorCode: name });
    expect(stopsSweep(verdict)).toBe(true);
  });

  it("treats a used key with a different payload as already sent", () => {
    expect(classifySendFailure({ name: "invalid_idempotent_request", statusCode: 409 })).toEqual({
      kind: "already_sent",
    });
  });

  it("retries a key still in flight", () => {
    expect(
      classifySendFailure({ name: "concurrent_idempotent_requests", statusCode: 409 }),
    ).toEqual({ kind: "retry", errorCode: "concurrent_idempotent_requests" });
  });

  it.each([
    ["rate_limit_exceeded", 429],
    ["daily_quota_exceeded", 429],
  ])("treats %s as rate limited, which stops the sweep", (name, statusCode) => {
    const verdict = classifySendFailure({ name, statusCode });
    expect(verdict).toEqual({ kind: "rate_limited", errorCode: name });
    expect(stopsSweep(verdict)).toBe(true);
  });

  it.each([
    ["internal_server_error", 500],
    ["application_error", 503],
    // A network error and a timeout both come back with no status.
    ["application_error", null],
  ])("retries %s (%s) without stopping the sweep", (name, statusCode) => {
    const verdict = classifySendFailure({ name, statusCode });
    expect(verdict).toEqual({ kind: "retry", errorCode: name });
    expect(stopsSweep(verdict)).toBe(false);
  });

  it("never treats a final refusal as a reason to stop the sweep", () => {
    expect(stopsSweep(classifySendFailure({ name: "validation_error", statusCode: 422 }))).toBe(
      false,
    );
  });
});
