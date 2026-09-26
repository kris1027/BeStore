import { defineConfig } from "vitest/config";

// Three projects: `unit` needs no database (`pnpm test`); `db` runs the *.db.test.ts suites
// against TEST_DATABASE_URL (`pnpm test:db`, which migrates that database first); `stack` runs
// the *.stack.test.ts suites against the local Supabase stack's auth schema (`pnpm test:stack`).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: [
            "node_modules/**",
            ".next/**",
            "tests/e2e/**",
            "**/*.db.test.ts",
            "**/*.stack.test.ts",
          ],
          unstubEnvs: true,
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["**/*.db.test.ts"],
          exclude: ["node_modules/**", ".next/**"],
          // Every file truncates the same database, so files must not run side by side.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: "stack",
          include: ["**/*.stack.test.ts"],
          exclude: ["node_modules/**", ".next/**"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
