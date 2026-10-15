import { describe, expect, it } from "vitest";

import { accountMessages, accountNotice } from "./messages";

// spec 0012, AC-3: /account maps its `notice` query param to fixed text, never echoing the URL.

describe("accountNotice", () => {
  it("maps the known keys to their text", () => {
    expect(accountNotice("ready")).toBe("Your account is ready.");
    expect(accountNotice("password_changed")).toBe(accountMessages.passwordChanged);
  });

  it.each([
    "<script>alert(1)</script>",
    "toString",
    "__proto__",
    "constructor",
    "",
    undefined,
    ["ready"],
  ])("shows nothing for %j", (value) => {
    expect(accountNotice(value)).toBeNull();
  });
});
