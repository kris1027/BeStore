import "server-only";

import { db } from "@/lib/db";

// AC-16: 5 wrong codes for one factor in 15 minutes locks the MFA step for that factor.
export const MAX_WRONG_CODES = 5;
export const WRONG_CODE_WINDOW_MINUTES = 15;

// Each challengeAndVerify call leaves one auth.mfa_challenges row, verified or not, so this
// counts per account across every session and IP. A counter cookie would be deleted by an
// attacker. Read only: this reads a Supabase internal table, which
// tests/stack/mfa-challenges.stack.test.ts pins against the local stack.
export async function countRecentWrongCodes(factorId: string): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM auth.mfa_challenges
    WHERE factor_id = ${factorId}::uuid
      AND verified_at IS NULL
      AND created_at > now() - make_interval(mins => ${WRONG_CODE_WINDOW_MINUTES})
  `;
  return rows[0]?.count ?? 0;
}

export function isLockedOut(wrongCodes: number): boolean {
  return wrongCodes >= MAX_WRONG_CODES;
}
