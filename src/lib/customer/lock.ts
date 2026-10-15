import "server-only";

import type { Tx } from "@/lib/db";

// spec 0012: one mutex per customer for every write that touches their cart, addresses or order
// links. "No cart yet" and "no address yet" have no row to lock, and one lock keeps the lock
// order question away. It lives until the transaction ends.
export async function lockCustomer(tx: Tx, customerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer:${customerId}`}))`;
}
