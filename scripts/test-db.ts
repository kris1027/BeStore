import { spawnSync } from "node:child_process";

import { config } from "dotenv";

import { safeTestDatabaseUrl } from "../tests/db/guard";

// Runs the db test project: migrate TEST_DATABASE_URL, then Vitest. The guard runs first,
// so a missing or dev database URL fails before anything touches a database.
config({ path: [".env.local", ".env"], quiet: true });

const testUrl = safeTestDatabaseUrl(process.env);
const extraArgs = process.argv.slice(2);

run(["exec", "prisma", "migrate", "deploy"], { DIRECT_URL: testUrl });
run(["exec", "vitest", "run", "--project", "db", ...extraArgs], {});

function run(args: readonly string[], env: Readonly<Record<string, string>>) {
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
