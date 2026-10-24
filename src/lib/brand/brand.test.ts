import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatHex } from "culori";
import { describe, expect, it } from "vitest";

import { parseRootTokens } from "@/lib/design/contrast";

import { brand } from "./brand";

const tokens = parseRootTokens(readFileSync(join(process.cwd(), "app/globals.css"), "utf8"));

describe("brand.colors", () => {
  it.each([
    ["background", brand.colors.background],
    ["foreground", brand.colors.foreground],
  ] as const)("matches the --%s token", (token, hex) => {
    expect(formatHex(tokens[token])).toBe(hex);
  });
});
