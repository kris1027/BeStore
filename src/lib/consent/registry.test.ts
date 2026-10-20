import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { entryMatches } from "./consent";
import { cookieRegistry } from "./registry";

// spec 0017, Build details 10: every cookie the code sets is in the registry, so the cookie table
// and a withdrawal can never miss one. Cookies are set in three ways: `cookies().set(NAME, ...)`
// on the server, `document.cookie = \`${NAME}=...\`` in the browser, and the Supabase auth loops
// (`cookiesToSet`), whose names Supabase picks and the `sb-*-auth-token*` entry covers.

const root = process.cwd();

// The style guide demo sets its own demo cookie, listed in its own demo registry.
const skipped = ["src/generated/", "src/features/style-guide/"];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => !skipped.some((prefix) => file.startsWith(prefix)));
}

const files = [...sourceFiles("app"), ...sourceFiles("src"), "proxy.ts"];
const sources = new Map(files.map((file) => [file, readFileSync(join(root, file), "utf8")]));
const allSource = [...sources.values()].join("\n");

// `const NAME = "value"` anywhere in the tree.
function constantValue(name: string): string | undefined {
  return new RegExp(`const ${name}\\s*=\\s*"([^"]+)"`).exec(allSource)?.[1];
}

type Write = { readonly file: string; readonly name: string | undefined; readonly code: string };

function cookieWrites(): readonly Write[] {
  const writes: Write[] = [];
  for (const [file, text] of sources) {
    for (const match of text.matchAll(/cookies\(\)\)\.set\(\s*([A-Z_][A-Z0-9_]*|"[^"]+")/g)) {
      const arg = match[1] ?? "";
      const name = arg.startsWith('"') ? arg.slice(1, -1) : constantValue(arg);
      writes.push({ file, name, code: match[0] });
    }
    for (const match of text.matchAll(/document\.cookie\s*=\s*([^;\n]+)/g)) {
      const rhs = match[1] ?? "";
      const template = /^`(?:\$\{([A-Z_][A-Z0-9_]*)\}|([\w-]+))=/.exec(rhs);
      let name: string | undefined;
      if (template) name = template[2] ?? constantValue(template[1] ?? "");
      // The consent cookie's own writer, and the withdrawal's delete (it only removes cookies).
      else if (rhs.startsWith("consentCookieString(")) name = constantValue("CONSENT_COOKIE");
      else if (rhs.startsWith("expiredCookieString(")) continue;
      writes.push({ file, name, code: match[0] });
    }
  }
  return writes;
}

describe("the cookie registry", () => {
  const writes = cookieWrites();

  it("finds the cookies the store sets", () => {
    const names = writes.map((write) => write.name);
    expect(names).toEqual(
      expect.arrayContaining(["bestore_cart", "bestore_consent", "sidebar_state"]),
    );
  });

  it.each(writes.map((write) => [write.file, write.code, write.name] as const))(
    "%s sets a listed cookie (%s)",
    (_file, _code, name) => {
      expect(name, "the cookie name could not be read; name it with a const").toBeDefined();
      expect(cookieRegistry.some((entry) => entryMatches(entry, name ?? ""))).toBe(true);
    },
  );

  it("covers the Supabase auth cookies, the only ones set by name loops", () => {
    const loops = files.filter((file) => /cookiesToSet/.test(sources.get(file) ?? ""));
    expect(loops.length).toBeGreaterThan(0);
    for (const name of ["sb-abcd-auth-token", "sb-abcd-auth-token.0", "sb-abcd-auth-token.1"]) {
      expect(cookieRegistry.some((entry) => entryMatches(entry, name))).toBe(true);
    }
  });

  // AC-17: it ships with necessary cookies only, so the banner never shows today (AC-18).
  it("lists necessary cookies only", () => {
    expect(cookieRegistry.every((entry) => entry.category === "necessary")).toBe(true);
  });

  it("names Stripe's cookies, set on Stripe's domain, which this site cannot delete", () => {
    const stripe = cookieRegistry.find((entry) => entry.name.includes("Stripe"));
    expect(stripe?.match).toBeNull();
  });
});
