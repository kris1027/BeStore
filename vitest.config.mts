import { createRequire } from "node:module";

import { defineConfig, type Plugin } from "vitest/config";

import { legalContent } from "./src/lib/legal/content-path";

const require = createRequire(import.meta.url);
const rawTextLoader = require("./scripts/raw-text-loader.cjs") as (source: string) => string;

// The raw text loader rule of next.config.ts, run by Vitest: a legal text imports as its string.
function rawLegalMarkdown(): Plugin {
  return {
    name: "raw-legal-markdown",
    enforce: "pre",
    transform(code, id) {
      if (!legalContent.test(id)) return null;
      return { code: rawTextLoader(code), map: null };
    },
  };
}

// Four projects: `unit` needs no database (`pnpm test`); `db` runs the *.db.test.ts suites
// against TEST_DATABASE_URL (`pnpm test:db`, which migrates that database first); `stack` runs
// the *.stack.test.ts suites against the local Supabase stack's auth schema (`pnpm test:stack`);
// `build` runs the *.build.test.ts suites, which call `next build` (`pnpm test:build`).
export default defineConfig({
  plugins: [rawLegalMarkdown()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // spec 0011, AC-16: no test ever sends a real email.
    env: { EMAIL_TRANSPORT: "log" },
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
            "**/*.build.test.ts",
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
      {
        extends: true,
        test: {
          name: "build",
          include: ["**/*.build.test.ts"],
          exclude: ["node_modules/**", ".next/**"],
          testTimeout: 300_000,
        },
      },
    ],
  },
});
