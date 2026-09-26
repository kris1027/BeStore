import { afterAll, describe, expect, it, vi } from "vitest";

import { anonClient, serviceClient, stackPassword, uniqueEmail } from "./stack";

vi.mock("server-only", () => ({}));

// Spec 0004, AC-16: the wrong code limit reads Supabase's internal auth.mfa_challenges table.
// This pins the columns it relies on and the one row per attempt behavior, so a Supabase
// upgrade that reshapes them fails here rather than silently disabling the lockout.
const { countRecentWrongCodes, isLockedOut, MAX_WRONG_CODES, withFactorLock } =
  await import("@/features/admin-auth/mfa-lockout");
const { db } = await import("@/lib/db");

afterAll(() => db.$disconnect());

describe("auth.mfa_challenges", () => {
  it("has the columns the lockout query reads", async () => {
    const columns = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'mfa_challenges'`;
    const types = Object.fromEntries(columns.map((c) => [c.column_name, c.data_type]));
    expect(types).toMatchObject({
      factor_id: "uuid",
      created_at: "timestamp with time zone",
      verified_at: "timestamp with time zone",
    });
  });

  it("counts each wrong code once per factor, and not the right one", async () => {
    const email = uniqueEmail();
    const created = await serviceClient().auth.admin.createUser({
      email,
      password: stackPassword,
      email_confirm: true,
    });
    expect(created.error).toBeNull();

    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: stackPassword });
    const { data: factor } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (!factor) throw new Error("enroll failed");

    expect(await countRecentWrongCodes(factor.id)).toBe(0);
    for (const code of ["000000", "111111"]) {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      expect(error?.code).toBe("mfa_verification_failed");
    }
    expect(await countRecentWrongCodes(factor.id)).toBe(2);
  });

  it("lets no more than 5 codes through when they arrive at once", async () => {
    const email = uniqueEmail();
    const created = await serviceClient().auth.admin.createUser({
      email,
      password: stackPassword,
      email_confirm: true,
    });
    expect(created.error).toBeNull();

    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: stackPassword });
    const { data: factor } = await client.auth.mfa.enroll({ factorType: "totp" });
    if (!factor) throw new Error("enroll failed");

    // The same check verifyTotp runs, fired as one burst.
    const checked = await Promise.all(
      Array.from({ length: MAX_WRONG_CODES + 3 }, () =>
        withFactorLock(factor.id, async (wrongCodes) => {
          if (isLockedOut(wrongCodes)) return false;
          await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: "000000" });
          return true;
        }),
      ),
    );

    expect(checked.filter(Boolean)).toHaveLength(MAX_WRONG_CODES);
    expect(await countRecentWrongCodes(factor.id)).toBe(MAX_WRONG_CODES);
  });
});
