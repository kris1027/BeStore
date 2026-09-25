type Env = Readonly<Record<string, string | undefined>>;

// The db suites truncate every table, so pointing them at the dev (or a deployed) database
// would wipe it. Compares host, port and database name, so query params such as
// `?pgbouncer=true` cannot disguise the same database.
export function safeTestDatabaseUrl(env: Env): string {
  const testUrl = env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is not set. Point it at a dedicated test database.");
  }
  const target = databaseIdentity(testUrl);
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const other = env[name];
    if (other && databaseIdentity(other) === target) {
      throw new Error(`TEST_DATABASE_URL points at the same database as ${name}. Refusing to run.`);
    }
  }
  return testUrl;
}

function databaseIdentity(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
  return `${host}:${parsed.port || "5432"}${parsed.pathname}`;
}
