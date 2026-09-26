import "server-only";

import { db } from "@/lib/db";

// AC-16: 5 wrong codes for one factor in 15 minutes locks the MFA step for that factor.
export const MAX_WRONG_CODES = 5;
export const WRONG_CODE_WINDOW_MINUTES = 15;

type RawQuery = Pick<typeof db, "$queryRaw">;

// Each challengeAndVerify call leaves one auth.mfa_challenges row, verified or not, so this
// counts per account across every session and IP. A counter cookie would be deleted by an
// attacker. Read only: this reads a Supabase internal table, which
// tests/stack/mfa-challenges.stack.test.ts pins against the local stack.
async function countWith(client: RawQuery, factorId: string): Promise<number> {
  const rows = await client.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM auth.mfa_challenges
    WHERE factor_id = ${factorId}::uuid
      AND verified_at IS NULL
      AND created_at > now() - make_interval(mins => ${WRONG_CODE_WINDOW_MINUTES})
  `;
  return rows[0]?.count ?? 0;
}

export function countRecentWrongCodes(factorId: string): Promise<number> {
  return countWith(db, factorId);
}

// Count and check must be one step per factor: otherwise a burst of parallel requests all
// read the same count before any of their challenge rows exist, and get past the limit.
// The advisory lock lives until the transaction ends, so run (the Supabase check, whose row
// Supabase commits before it answers) finishes before the next attempt counts.
export async function withFactorLock<T>(
  factorId: string,
  run: (wrongCodes: number) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      // $executeRaw, since $queryRaw cannot read the void this function returns.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${factorId}))`;
      return run(await countWith(tx, factorId));
    },
    // Covers waiting on the lock plus one round trip to the Auth server.
    { timeout: 15_000 },
  );
}

export function isLockedOut(wrongCodes: number): boolean {
  return wrongCodes >= MAX_WRONG_CODES;
}
