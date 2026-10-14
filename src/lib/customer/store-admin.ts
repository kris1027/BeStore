import "server-only";

import { db, type Tx } from "@/lib/db";

type Client = Pick<Tx, "$queryRaw">;

// spec 0012, AC-8 and AC-19: a user who runs the store (an admin_users row in any state, or a
// verified authenticator) always takes the admin path for passwords, so an inbox alone never
// resets a password that guards /admin. auth.mfa_factors is Supabase's own table: read only.
export async function runsTheStore(userId: string, client: Client = db): Promise<boolean> {
  const rows = await client.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM admin_users WHERE id = ${userId}::uuid)
        OR EXISTS (
          SELECT 1 FROM auth.mfa_factors
          WHERE user_id = ${userId}::uuid AND status = 'verified'
        ) AS found`;
  return rows[0]?.found ?? false;
}
