import { describe, expect, it } from "vitest";

import { settle } from "./settle";

// spec 0012, AC-1 and AC-24: a Supabase call run in after() turns into a reason code for the log.

describe("settle", () => {
  it("returns null when the call went through", async () => {
    expect(await settle(async () => ({ error: null }))).toBeNull();
  });

  it.each([
    [{ code: "over_email_send_rate_limit", status: 429 }, "rate_limited"],
    [{ code: "unexpected_failure", status: 500 }, "unavailable"],
    [{ code: "email_address_invalid", status: 400 }, "rejected"],
  ])("classifies %j as %s", async (error, reason) => {
    expect(await settle(async () => ({ error }))).toBe(reason);
  });

  it("reads a thrown call (the network) as unavailable instead of throwing", async () => {
    expect(
      await settle(async () => {
        throw new Error("fetch failed");
      }),
    ).toBe("unavailable");
  });
});
