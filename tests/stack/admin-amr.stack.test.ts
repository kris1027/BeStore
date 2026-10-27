import { describe, expect, it } from "vitest";

import { decideAdminAccess } from "../../src/features/admin-auth/access";
import { decideAdminGate } from "../../src/features/admin-auth/proxy-decision";
import { anonClient, serviceClient, stackPassword, uniqueEmail } from "./stack";

// spec 0019, AC-2: the whole password only rule rests on what Supabase writes into `amr`. A
// password sign in records a `password` entry; a session made by verifying a recovery link
// records none. A Supabase upgrade that changes this fails here, not silently in the guard.

async function claimsOf(client: ReturnType<typeof anonClient>) {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) throw error ?? new Error("no claims");
  return data.claims;
}

async function newUser() {
  const email = uniqueEmail();
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password: stackPassword,
    email_confirm: true,
  });
  if (error) throw error;
  return { email, id: data.user.id };
}

const adminRow = (id: string, email: string) => ({ id, email, name: "Ada", disabledAt: null });

describe("amr", () => {
  it("has a password entry after a password sign in, which the guard allows", async () => {
    const { email, id } = await newUser();
    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: stackPassword });

    const claims = await claimsOf(client);
    expect(JSON.stringify(claims.amr)).toContain('"password"');
    const verdict = decideAdminAccess({
      userId: id,
      amr: claims.amr,
      adminRow: adminRow(id, email),
      nowMs: Date.now(),
    });
    expect(verdict.kind).toBe("allow");
  });

  it("has no password entry after a recovery link, which the guard and proxy send to sign in", async () => {
    const { email, id } = await newUser();
    const link = await serviceClient().auth.admin.generateLink({ type: "recovery", email });
    if (link.error) throw link.error;
    const client = anonClient();
    const { error } = await client.auth.verifyOtp({
      type: "recovery",
      token_hash: link.data.properties.hashed_token,
    });
    expect(error).toBeNull();

    const claims = await claimsOf(client);
    expect(JSON.stringify(claims.amr)).not.toContain('"password"');
    const input = { userId: id, amr: claims.amr, adminRow: adminRow(id, email), nowMs: Date.now() };
    expect(decideAdminAccess(input)).toEqual({ kind: "sign-in" });
    expect(
      decideAdminGate({
        pathname: "/admin",
        search: "",
        method: "GET",
        isServerAction: false,
        claims,
        nowMs: Date.now(),
        adminRow: adminRow(id, email),
      }),
    ).toEqual({ kind: "redirect", to: "/admin/sign-in?next=%2Fadmin" });
  });
});
