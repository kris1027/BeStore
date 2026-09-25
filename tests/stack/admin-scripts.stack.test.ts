import { afterAll, describe, expect, it } from "vitest";

import {
  connect,
  createAdmin,
  disableAdmin,
  findAuthUserId,
  resetAdminMfa,
} from "../../scripts/admin/lib";
import { anonClient, serviceClient, stackEnv, stackPassword, uniqueEmail } from "./stack";

// Spec 0004, AC-11: the admin:create, admin:disable and admin:reset-mfa cores against the
// local stack. The CLIs around them only read flags and prompt for the password.
stackEnv();
const deps = connect(undefined);

afterAll(() => deps.close());

describe("createAdmin", () => {
  it("creates a confirmed auth user and the admin row, email lower cased", async () => {
    const email = uniqueEmail();
    const { id, existingUser } = await createAdmin(deps, {
      email: email.toUpperCase(),
      name: " Ada ",
      password: stackPassword,
    });

    expect(existingUser).toBe(false);
    expect(await deps.db.adminUser.findUnique({ where: { id } })).toMatchObject({
      email,
      name: "Ada",
      disabledAt: null,
    });
    const { error } = await anonClient().auth.signInWithPassword({
      email,
      password: stackPassword,
    });
    expect(error).toBeNull();
  });

  it("keeps an existing user's password, confirms the email, and re-enables a disabled row", async () => {
    const email = uniqueEmail();
    const customerPassword = "Customer-pass-1";
    const created = await serviceClient().auth.admin.createUser({
      email,
      password: customerPassword,
      email_confirm: false,
    });
    const userId = created.data.user?.id;

    const first = await createAdmin(deps, { email, name: "Grace", password: null });
    expect(first).toEqual({ id: userId, existingUser: true });
    await disableAdmin(deps, email);

    await createAdmin(deps, { email, name: "Grace Hopper", password: null });
    expect(await deps.db.adminUser.findUnique({ where: { id: first.id } })).toMatchObject({
      name: "Grace Hopper",
      disabledAt: null,
    });
    const { error } = await anonClient().auth.signInWithPassword({
      email,
      password: customerPassword,
    });
    expect(error).toBeNull();
    expect(await findAuthUserId(deps.db, email.toUpperCase())).toBe(first.id);
  });
});

describe("disableAdmin", () => {
  it("sets disabled_at and refuses an unknown email", async () => {
    const email = uniqueEmail();
    const { id } = await createAdmin(deps, { email, name: "Alan", password: stackPassword });

    await disableAdmin(deps, email);
    const row = await deps.db.adminUser.findUnique({ where: { id } });
    expect(row?.disabledAt).toBeInstanceOf(Date);
    await expect(disableAdmin(deps, uniqueEmail())).rejects.toThrow("No admin has that email.");
  });
});

describe("resetAdminMfa", () => {
  it("removes every factor and every session", async () => {
    const email = uniqueEmail();
    const { id } = await createAdmin(deps, { email, name: "Linus", password: stackPassword });
    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: stackPassword });
    await client.auth.mfa.enroll({ factorType: "totp" });

    const result = await resetAdminMfa(deps, email);

    expect(result).toEqual({ id, factorsRemoved: 1 });
    const sessions = await deps.db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth.sessions WHERE user_id = ${id}::uuid`;
    expect(sessions[0]?.count).toBe(0);
    const { error } = await client.auth.getUser();
    expect(error).not.toBeNull();
  });
});
