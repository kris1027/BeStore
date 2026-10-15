import { testDb } from "./client";

// The test database is plain Postgres, without Supabase's auth schema. Account code reads two of
// its tables (auth.users, auth.mfa_factors) read only, so the suites that need them get a minimal
// stand in. It is marked, and only a marked stand in is ever cleared, so a database with the real
// auth schema is never touched.
const marker = "bestore test stub";

export async function ensureAuthStub() {
  await testDb.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS auth`);
  await testDb.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
  await testDb.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS auth.mfa_factors (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id uuid NOT NULL,
       factor_type text NOT NULL DEFAULT 'totp',
       status text NOT NULL
     )`,
  );
  const [row] = await testDb.$queryRaw<{ comment: string | null }[]>`
    SELECT obj_description('auth.users'::regclass, 'pg_class') AS comment`;
  if (row?.comment === null) {
    await testDb.$executeRawUnsafe(`COMMENT ON TABLE auth.users IS '${marker}'`);
  } else if (row?.comment !== marker) {
    throw new Error("auth.users is not the test stand in; refusing to use this database.");
  }
}

export async function resetAuthStub() {
  await ensureAuthStub();
  await testDb.$executeRawUnsafe(`TRUNCATE auth.users, auth.mfa_factors`);
}

export async function addAuthUser(id: string) {
  await testDb.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
}

export async function addVerifiedFactor(userId: string) {
  await testDb.$executeRaw`
    INSERT INTO auth.mfa_factors (user_id, status) VALUES (${userId}::uuid, 'verified')`;
}
