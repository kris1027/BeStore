import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contrastPairs, measurePair, parseRootTokens } from "@/lib/design/contrast";

// Read from the stylesheet itself, so the style guide can never show a stale value. The page
// is static, so this runs at build time, where app/ is on disk.
export function loadTokenReport() {
  const tokens = parseRootTokens(readFileSync(join(process.cwd(), "app/globals.css"), "utf8"));
  const colors = Object.entries(tokens).filter(([, value]) => value.startsWith("oklch("));
  const pairs = contrastPairs.map((pair) => ({
    ...pair,
    ratio: measurePair(tokens, pair),
  }));
  return { tokens, colors, pairs };
}
