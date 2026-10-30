import { describe, expect, it, vi } from "vitest";

import { type AdminDeps, findAdminId, setAdminPassword } from "./lib";

// spec 0019, AC-7: the admin:reset-password steps with the database and Supabase faked at the
// edge. The script itself runs against the local stack in admin-scripts.stack.test.ts; this
// covers the Supabase refusal, which the stack cannot be made to produce on demand.

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

describe("findAdminId", () => {
  it("looks the admin up by lower cased email", async () => {
    const { fake, findUnique } = deps({ id: ADMIN_ID });

    await expect(findAdminId(fake.db, " Ada@Example.COM ")).resolves.toBe(ADMIN_ID);
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "ada@example.com" } });
  });

  it("answers null for an email with no admin row", async () => {
    const { fake } = deps(null);

    await expect(findAdminId(fake.db, "ada@example.com")).resolves.toBeNull();
  });
});

describe("setAdminPassword", () => {
  it("sets the password on that id", async () => {
    const { fake, updateUserById } = deps({ id: ADMIN_ID });

    await setAdminPassword(fake, ADMIN_ID, "Garden-gnome-4242");
    expect(updateUserById).toHaveBeenCalledWith(ADMIN_ID, { password: "Garden-gnome-4242" });
  });

  it("passes on Supabase's reason when it refuses the password", async () => {
    const { fake } = deps({ id: ADMIN_ID }, { message: "Password is known to be weak" });

    await expect(setAdminPassword(fake, ADMIN_ID, "Garden-gnome-4242")).rejects.toThrow(
      "Could not set the password: Password is known to be weak",
    );
  });

  it("never puts the password in its error", async () => {
    const { fake } = deps({ id: ADMIN_ID }, { message: "refused" });

    const error = await setAdminPassword(fake, ADMIN_ID, "Garden-gnome-4242").catch(
      (e: unknown) => e,
    );

    expect((error as Error).message).not.toContain("Garden-gnome-4242");
  });
});
