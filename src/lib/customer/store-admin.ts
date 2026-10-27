import "server-only";

import { db, type Tx } from "@/lib/db";

type Client = Pick<Tx, "$queryRaw">;

// spec 0019, AC-10: a user who runs the store (an admin_users row in any state) never changes
// their password from an inbox or an account page; an admin password changes only from the
// terminal, so an inbox alone never opens /admin.
export async function runsTheStore(userId: string, client: Client = db): Promise<boolean> {
  const rows = await client.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM admin_users WHERE id = ${userId}::uuid) AS found`;
  return rows[0]?.found ?? false;
}
