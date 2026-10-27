import { describe, expect, it, vi } from "vitest";

import { type AdminDeps, resetAdminPassword } from "./lib";

// spec 0019, AC-7: resetAdminPassword with the database and Supabase faked at the edge. The
// real lookup and the session wipe run against the local stack in admin-scripts.stack.test.ts;
// this covers the Supabase refusal, which the stack cannot be made to produce on demand.

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";

function deps(admin: { id: string } | null, updateError: { message: string } | null = null) {
  const findUnique = vi.fn(async () => admin);
  const updateUserById = vi.fn(async () => ({ data: {}, error: updateError }));
  const fake = {
    db: { adminUser: { findUnique } },
    supabase: { auth: { admin: { updateUserById } } },
  } as unknown as AdminDeps;
  return { fake, findUnique, updateUserById };
}

describe("resetAdminPassword", () => {
  it("looks the admin up by lower cased email and sets the password on that id", async () => {
    const { fake, findUnique, updateUserById } = deps({ id: ADMIN_ID });

    await expect(resetAdminPassword(fake, " Ada@Example.COM ", "Garden-gnome-4242")).resolves.toBe(
      ADMIN_ID,
    );
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "ada@example.com" } });
    expect(updateUserById).toHaveBeenCalledWith(ADMIN_ID, { password: "Garden-gnome-4242" });
  });

  it("refuses an email with no admin row and changes nothing", async () => {
    const { fake, updateUserById } = deps(null);

    await expect(resetAdminPassword(fake, "ada@example.com", "Garden-gnome-4242")).rejects.toThrow(
      "No admin has that email.",
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("passes on Supabase's reason when it refuses the password", async () => {
    const { fake } = deps({ id: ADMIN_ID }, { message: "Password is known to be weak" });

    await expect(resetAdminPassword(fake, "ada@example.com", "Garden-gnome-4242")).rejects.toThrow(
      "Could not set the password: Password is known to be weak",
    );
  });

  it("never puts the password in its error", async () => {
    const { fake } = deps({ id: ADMIN_ID }, { message: "refused" });

    const error = await resetAdminPassword(fake, "ada@example.com", "Garden-gnome-4242").catch(
      (e: unknown) => e,
    );

    expect((error as Error).message).not.toContain("Garden-gnome-4242");
  });
});
