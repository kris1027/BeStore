import { describe, expect, it, vi } from "vitest";

import { promptAdminPassword } from "./cli";

// spec 0019, AC-7 and AC-16: the password prompt shared by admin:create and admin:reset-password.
// The stack test runs admin:reset-password end to end; this pins the messages and the order of
// prompts.

const STRONG = "Garden-gnome-4242";

function prompter(answers: readonly string[]) {
  const queue = [...answers];
  const hidden = vi.fn(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("No input.");
    return next;
  });
  return { hidden, close: vi.fn() };
}

describe("promptAdminPassword", () => {
  it("returns a password that passes the admin rule and was typed the same twice", async () => {
    const prompt = prompter([STRONG, STRONG]);

    await expect(promptAdminPassword(prompt)).resolves.toBe(STRONG);
    expect(prompt.hidden.mock.calls).toEqual([["Password: "], ["Password again: "]]);
  });

  // covers: AC-16
  it("refuses 13 characters by naming the 14 character rule, before asking again", async () => {
    const prompt = prompter(["Garden-gnome4"]);

    await expect(promptAdminPassword(prompt)).rejects.toThrow(
      "The password needs:\n- At least 14 characters",
    );
    expect(prompt.hidden).toHaveBeenCalledOnce();
  });

  it("names every missing part of a weak password, one per line", async () => {
    const prompt = prompter(["short"]);

    const error = await promptAdminPassword(prompt).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      [
        "The password needs:",
        "- At least 8 characters",
        "- An upper case letter",
        "- A digit",
        "- A symbol",
        "- At least 14 characters",
      ].join("\n"),
    );
  });

  // covers: AC-7
  it("refuses two different passwords", async () => {
    const prompt = prompter([STRONG, `${STRONG}x`]);

    await expect(promptAdminPassword(prompt)).rejects.toThrow("The passwords do not match.");
  });

  it("fails cleanly when input ends before the second password", async () => {
    const prompt = prompter([STRONG]);

    await expect(promptAdminPassword(prompt)).rejects.toThrow("No input.");
  });
});
