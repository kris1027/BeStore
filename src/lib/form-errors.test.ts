import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { applyFieldErrors, fieldErrors } from "./form-errors";

describe("fieldErrors", () => {
  it("keys every message by its field", () => {
    const schema = z.object({ email: z.string().min(1, "Enter it"), code: z.string() });
    const parsed = schema.safeParse({ email: "", code: 1 });
    if (parsed.success) throw new Error("expected a failed parse");

    const errors = fieldErrors<"email" | "code">(parsed.error);

    expect(errors.email).toEqual(["Enter it"]);
    expect(errors.code).toHaveLength(1);
  });
});

describe("applyFieldErrors", () => {
  it("sets the first message of each field and focuses only the first field", () => {
    const setError = vi.fn();

    applyFieldErrors(setError, { email: ["Enter it", "Second"], password: ["Too short"] });

    expect(setError.mock.calls).toEqual([
      ["email", { type: "server", message: "Enter it" }, { shouldFocus: true }],
      ["password", { type: "server", message: "Too short" }, { shouldFocus: false }],
    ]);
  });
});
