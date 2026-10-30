import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import { connect, createAdmin, disableAdmin, findAuthUserId } from "../../scripts/admin/lib";
import { anonClient, serviceClient, stackEnv, stackPassword, uniqueEmail } from "./stack";

// Spec 0004, AC-11 and spec 0019, AC-7 and AC-15: the admin:create and admin:disable cores, and
// the whole admin:reset-password script, against the local stack.
stackEnv();
const deps = connect(undefined);

afterAll(() => deps.close());

// The script as an operator runs it, the two typed passwords piped in (its prompt reads lines).
function resetPassword(email: string, passwords: readonly string[]) {
  const result = spawnSync(
    "node_modules/.bin/tsx",
    ["scripts/admin/reset-password.ts", "--email", email],
    { input: passwords.map((p) => `${p}\n`).join(""), encoding: "utf8", env: process.env },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr.trim() };
}

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
    expect(await disableAdmin(deps, uniqueEmail())).toBeNull();
  });
});

describe("admin:reset-password", () => {
  const newPassword = "Another-horse-42";

  it("changes an enabled admin's password, found by lower cased email", async () => {
    const email = uniqueEmail();
    await createAdmin(deps, { email, name: "Ada", password: stackPassword });

    const run = resetPassword(email.toUpperCase(), [newPassword, newPassword]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Password changed for ${email.toUpperCase()}.`);
    expect(run.stdout).toContain("Every session they had is signed out.");
    const old = await anonClient().auth.signInWithPassword({ email, password: stackPassword });
    expect(old.error).not.toBeNull();
    const fresh = await anonClient().auth.signInWithPassword({ email, password: newPassword });
    expect(fresh.error).toBeNull();
  });

  it("changes a disabled admin's password", async () => {
    const email = uniqueEmail();
    await createAdmin(deps, { email, name: "Alan", password: stackPassword });
    await disableAdmin(deps, email);

    expect(resetPassword(email, [newPassword, newPassword]).status).toBe(0);
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

    for (const target of [email, uniqueEmail()]) {
      const run = resetPassword(target, [newPassword, newPassword]);
      expect(run).toMatchObject({ status: 1, stderr: "No admin has that email." });
      // Refused before any prompt.
      expect(run.stdout).not.toContain("Password:");
    }
    const { error } = await anonClient().auth.signInWithPassword({
      email,
      password: stackPassword,
    });
    expect(error).toBeNull();
  });

  // covers: AC-16
  it("refuses a 13 character password and one typed differently twice, changing nothing", async () => {
    const email = uniqueEmail();
    await createAdmin(deps, { email, name: "Edsger", password: stackPassword });

    expect(resetPassword(email, ["Garden-gnome4"])).toMatchObject({
      status: 1,
      stderr: "The password needs:\n- At least 14 characters",
    });
    expect(resetPassword(email, [newPassword, `${newPassword}x`])).toMatchObject({
      status: 1,
      stderr: "The passwords do not match.",
    });
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

    expect(resetPassword(email, [newPassword, newPassword]).status).toBe(0);

    const { error } = await client.auth.getUser(access_token);
    expect(error).not.toBeNull();
    const refreshed = await client.auth.refreshSession({ refresh_token });
    expect(refreshed.error).not.toBeNull();
    const sessions = await deps.db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth.sessions WHERE user_id = ${id}::uuid`;
    expect(sessions[0]?.count).toBe(0);
  });
});
