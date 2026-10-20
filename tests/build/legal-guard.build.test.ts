import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { validEnv } from "../valid-env";

// spec 0017, AC-4 and Build details 7: a blank left in a legal text, or an unknown placeholder,
// must fail `next build` itself, not only the loader's unit tests. Each case builds a copy of the
// app with one fixture line added to terms.md. The copy sits under .next/, which git, tsc,
// ESLint and Vitest all skip, and below the repo, so Turbopack finds the repo's lockfile and
// node_modules. The throw comes while Next collects page data, before any page reads the
// database, so no database is needed.

const repo = path.resolve(import.meta.dirname, "../..");
const workRoot = path.join(repo, ".next", "legal-guard");

// What `next build` reads; the test files are left out, as they import from tests/.
const appFiles = [
  "app",
  "src",
  "emails",
  "public",
  "scripts/raw-text-loader.cjs",
  "proxy.ts",
  "instrumentation.ts",
  "next.config.ts",
  "next-env.d.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "package.json",
] as const;

function appCopy(name: string, termsFixture: string): string {
  const dir = path.join(workRoot, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  for (const file of appFiles) {
    cpSync(path.join(repo, file), path.join(dir, file), {
      recursive: true,
      filter: (source) => !/\.test\.tsx?$/.test(source),
    });
  }
  appendFileSync(path.join(dir, "src/lib/legal/content/terms.md"), `\n${termsFixture}\n`);
  return dir;
}

function nextBuild(cwd: string, env: Readonly<Record<string, string>>) {
  // Vitest sets NODE_ENV=test and EMAIL_TRANSPORT=log; a build runs as production, and a shell's
  // VERCEL_ENV must not leak into the case that runs without it.
  const { VERCEL_ENV: _vercelEnv, ...inherited } = process.env;
  const result = spawnSync(path.join(repo, "node_modules/.bin/next"), ["build"], {
    cwd,
    env: {
      ...inherited,
      ...validEnv,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      ...env,
    },
    encoding: "utf8",
    timeout: 280_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterAll(() => rmSync(workRoot, { recursive: true, force: true }));

describe("next build and the legal texts", () => {
  it("fails a production build while a [[TO FILL]] marker is left", () => {
    const dir = appCopy("marker", "[[TO FILL: build guard fixture]]");

    const { status, output } = nextBuild(dir, {
      VERCEL_ENV: "production",
      // Production refuses any other transport (spec 0011, AC-16).
      EMAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "re_buildguard",
    });

    expect(status).not.toBe(0);
    expect(output).toMatch(
      /terms\.md still has blanks to fill before launch: .*\[\[TO FILL: build guard fixture\]\]/,
    );
  });

  it("fails any build with an unknown placeholder", () => {
    const dir = appCopy("placeholder", "{{build.guardFixture}}");

    const { status, output } = nextBuild(dir, {});

    expect(status).not.toBe(0);
    expect(output).toContain("Unknown legal placeholder {{build.guardFixture}}");
  });
});
