import { describe, expect, it } from "vitest";

import { escapeLike } from "./like";

describe("escapeLike", () => {
  it("escapes the wildcards and the escape character", () => {
    expect(escapeLike("100% wool_blend\\x")).toBe("100\\% wool\\_blend\\\\x");
  });

  it("leaves other text alone", () => {
    expect(escapeLike("Linen tee")).toBe("Linen tee");
  });
});
