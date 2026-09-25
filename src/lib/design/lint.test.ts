import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { brand } from "@/lib/brand/brand";

import { findDesignViolations } from "./lint";

const root = process.cwd();

// The brand files own the name and fonts; shadcn's own components are reviewed on add;
// the lint names the patterns it looks for.
const allowed = [
  "src/lib/brand/",
  "src/components/ui/",
  "src/generated/",
  "src/lib/design/lint.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => !allowed.some((prefix) => file.startsWith(prefix)));
}

describe("design lint (rebrand guard)", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("src")];

  it("scans the app and src trees", () => {
    expect(files).toContain("app/layout.tsx");
    expect(files).toContain("src/components/layout/store-shell.tsx");
    expect(files).not.toContain("src/lib/brand/brand.ts");
  });

  it.each(files)("%s uses tokens and brand.name only", (file) => {
    const violations = findDesignViolations(readFileSync(join(root, file), "utf8"), brand.name);

    expect(violations).toEqual([]);
  });
});

describe("findDesignViolations", () => {
  const name = "Acme Store";

  it.each([
    'className="bg-neutral-900"',
    'className="p-4 text-red-600"',
    'className="hover:border-zinc-200/50"',
    'className="bg-white"',
    'className="dark:bg-background"',
    "<title>Acme Store</title>",
    'const title = "Acme Store | Shop";',
  ])("flags %s", (source) => {
    expect(findDesignViolations(source, name)).not.toEqual([]);
  });

  it.each([
    'className="bg-primary text-muted-foreground"',
    'className="border-input ring-ring/50"',
    'className="text-destructive"',
    "const heading = brand.name;",
    '"Acme Stores"',
    '"acme store"',
    'className="bg-neutral"',
  ])("allows %s", (source) => {
    expect(findDesignViolations(source, name)).toEqual([]);
  });

  it.each([
    'className="md:hover:bg-red-500"',
    'className="border-t-slate-300"',
    'className="ring-offset-white"',
    'className="text-black/80"',
  ])("flags the variant or opacity form %s", (source) => {
    expect(findDesignViolations(source, name)).not.toEqual([]);
  });

  it("reports every hit on a line", () => {
    const hits = findDesignViolations('className="bg-red-500 text-white dark:bg-card"', name);

    expect(hits.map((hit) => hit.match)).toEqual(["bg-red-500", "text-white", "dark:bg-card"]);
  });

  it("treats regex characters in the store name literally", () => {
    expect(findDesignViolations('"A.B Shop"', "A.B Shop")).toHaveLength(1);
    expect(findDesignViolations('"AxB Shop"', "A.B Shop")).toEqual([]);
  });

  it("allows an empty source", () => {
    expect(findDesignViolations("", name)).toEqual([]);
  });

  it("reports the line of each hit", () => {
    expect(findDesignViolations("ok\nclassName='bg-blue-500'", name)).toEqual([
      { line: 2, match: "bg-blue-500" },
    ]);
  });
});
