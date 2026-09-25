import { defineConfig } from "vitest/config";

// Two projects: `unit` needs no database (`pnpm test`); `db` runs the *.db.test.ts suites
// against TEST_DATABASE_URL (`pnpm test:db`, which migrates that database first).
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
          exclude: ["node_modules/**", ".next/**", "tests/e2e/**", "**/*.db.test.ts"],
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
    ],
  },
});
