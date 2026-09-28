import { describe, expect, it } from "vitest";

import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first character and the whole domain", () => {
    expect(maskEmail("kris@gmail.com")).toBe("k•••@gmail.com");
    expect(maskEmail("a@b.co")).toBe("a•••@b.co");
  });

  it("hides anything that is not an address", () => {
    expect(maskEmail("no-at-sign")).toBe("•••");
    expect(maskEmail("@domain.com")).toBe("•••");
  });
});
