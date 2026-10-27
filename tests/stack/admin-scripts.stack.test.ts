import { afterAll, describe, expect, it } from "vitest";

import {
  connect,
  createAdmin,
  disableAdmin,
  findAuthUserId,
  resetAdminPassword,
} from "../../scripts/admin/lib";
import { anonClient, serviceClient, stackEnv, stackPassword, uniqueEmail } from "./stack";

// Spec 0004, AC-11 and spec 0019, AC-7 and AC-15: the admin:create, admin:disable and
// admin:reset-password cores against the local stack. The CLIs around them only read flags and
// prompt for the password.
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

  it("sets a new password on an existing user, confirms the email, and re-enables a disabled row", async () => {
    const email = uniqueEmail();
    // A password planted through public sign up on an unconfirmed user (spec 0019, AC-15).
    const plantedPassword = "Planted-pass-1";
    const created = await serviceClient().auth.admin.createUser({
      email,
      password: plantedPassword,
      email_confirm: false,
    });
    const userId = created.data.user?.id;

    const first = await createAdmin(deps, { email, name: "Grace", password: stackPassword });
    expect(first).toEqual({ id: userId, existingUser: true });
    await disableAdmin(deps, email);

    await createAdmin(deps, { email, name: "Grace Hopper", password: stackPassword });
    expect(await deps.db.adminUser.findUnique({ where: { id: first.id } })).toMatchObject({
      name: "Grace Hopper",
      disabledAt: null,
    });
    const planted = await anonClient().auth.signInWithPassword({
      email,
      password: plantedPassword,
    });
    expect(planted.error).not.toBeNull();
    const { error } = await anonClient().auth.signInWithPassword({
      email,
      password: stackPassword,
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

describe("resetAdminPassword", () => {
  const newPassword = "Another-horse-42";

  it("changes an enabled admin's password, found by lower cased email", async () => {
    const email = uniqueEmail();
    const { id } = await createAdmin(deps, { email, name: "Ada", password: stackPassword });

    expect(await resetAdminPassword(deps, email.toUpperCase(), newPassword)).toBe(id);
    const old = await anonClient().auth.signInWithPassword({ email, password: stackPassword });
    expect(old.error).not.toBeNull();
    const fresh = await anonClient().auth.signInWithPassword({ email, password: newPassword });
    expect(fresh.error).toBeNull();
  });

  it("changes a disabled admin's password", async () => {
    const email = uniqueEmail();
    await createAdmin(deps, { email, name: "Alan", password: stackPassword });
    await disableAdmin(deps, email);

    await resetAdminPassword(deps, email, newPassword);
    const { error } = await anonClient().auth.signInWithPassword({ email, password: newPassword });
    expect(error).toBeNull();
  });

  it("refuses an email with no admin row, a customer's included", async () => {
    const email = uniqueEmail();
    await serviceClient().auth.admin.createUser({
      email,
      password: stackPassword,
      email_confirm: true,
    });

    await expect(resetAdminPassword(deps, email, newPassword)).rejects.toThrow(
      "No admin has that email.",
    );
    await expect(resetAdminPassword(deps, uniqueEmail(), newPassword)).rejects.toThrow(
      "No admin has that email.",
    );
    const { error } = await anonClient().auth.signInWithPassword({
      email,
      password: stackPassword,
    });
    expect(error).toBeNull();
  });

  // Records what the runbook states (spec 0019, Security model): Supabase's admin API password
  // change deletes every session of the user, so an attacker holding one is out at once.
  it("ends every session the admin had", async () => {
    const email = uniqueEmail();
    const { id } = await createAdmin(deps, { email, name: "Linus", password: stackPassword });
    const client = anonClient();
    const { data } = await client.auth.signInWithPassword({ email, password: stackPassword });
    if (!data.session) throw new Error("sign in failed");
    const { access_token, refresh_token } = data.session;

    await resetAdminPassword(deps, email, newPassword);

    const { error } = await client.auth.getUser(access_token);
    expect(error).not.toBeNull();
    const refreshed = await client.auth.refreshSession({ refresh_token });
    expect(refreshed.error).not.toBeNull();
    const sessions = await deps.db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth.sessions WHERE user_id = ${id}::uuid`;
    expect(sessions[0]?.count).toBe(0);
  });
});
