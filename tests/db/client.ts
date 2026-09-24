import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { beforeEach, expect } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { safeTestDatabaseUrl } from "./guard";

// Built from TEST_DATABASE_URL directly: src/lib/db.ts needs the full app env and is server only.
config({ path: [".env.local", ".env"], quiet: true });

export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: safeTestDatabaseUrl(process.env) }),
});

// Call once at the top of each *.db.test.ts file: every test starts from an empty store
// with the migration's settings row, and order numbers restart at 1001.
export function resetDatabaseBeforeEach() {
  beforeEach(async () => {
    const tables = await testDb.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'store_settings')`;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    if (list) await testDb.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    await testDb.$executeRaw`
      UPDATE store_settings SET flat_shipping_cents = 0, free_shipping_threshold_cents = NULL`;
  });
}

type Violation = { readonly code: string; readonly message: string };

// Through @prisma/adapter-pg the Postgres error sits at meta.driverAdapterError.cause, for both
// model queries and raw SQL (spec 0002: match on the SQLSTATE, not on a Prisma code).
function violationOf(error: unknown): Violation | undefined {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta
    ?.driverAdapterError?.cause as
    { originalCode?: unknown; originalMessage?: unknown } | undefined;
  if (typeof cause?.originalCode !== "string") return undefined;
  return { code: cause.originalCode, message: String(cause.originalMessage ?? "") };
}

// Postgres SQLSTATEs the schema relies on.
export const SQLSTATE = {
  notNull: "23502",
  foreignKey: "23503",
  unique: "23505",
  check: "23514",
} as const;

// Asserts the query is rejected by Postgres with this SQLSTATE, naming this constraint,
// so a test cannot pass because some other rule happened to fire.
export async function expectViolation(
  query: PromiseLike<unknown>,
  code: (typeof SQLSTATE)[keyof typeof SQLSTATE],
  constraint?: string,
): Promise<void> {
  let violation: Violation | undefined;
  try {
    await query;
  } catch (error) {
    violation = violationOf(error);
    if (!violation) throw error;
  }
  expect(violation, "expected the query to be rejected").toBeDefined();
  expect(violation?.code).toBe(code);
  if (constraint) expect(violation?.message).toContain(`"${constraint}"`);
}
