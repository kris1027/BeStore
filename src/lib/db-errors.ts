// Through @prisma/adapter-pg the Postgres error sits at meta.driverAdapterError.cause (spec
// 0002: match on the SQLSTATE and constraint name, not on a Prisma code).
type PgCause = { readonly originalCode?: unknown; readonly originalMessage?: unknown };

function pgCause(error: unknown): PgCause | undefined {
  if (typeof error !== "object" || error === null || !("meta" in error)) return undefined;
  const meta = error.meta as { driverAdapterError?: { cause?: PgCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

// The constraint a unique violation (23505) names, or null for any other error.
export function uniqueViolation(error: unknown): string | null {
  const cause = pgCause(error);
  if (cause?.originalCode !== "23505") return null;
  const match = /constraint "([^"]+)"/.exec(String(cause.originalMessage ?? ""));
  return match?.[1] ?? "";
}
