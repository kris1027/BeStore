import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contrastPairs, measurePair, parseRootTokens } from "./contrast";

const tokens = parseRootTokens(readFileSync(join(process.cwd(), "app/globals.css"), "utf8"));

describe("token contrast (WCAG AA)", () => {
  it.each(contrastPairs.map((pair) => [pair.label, pair] as const))(
    "%s meets its minimum",
    (_label, pair) => {
      expect(measurePair(tokens, pair)).toBeGreaterThanOrEqual(pair.min);
    },
  );
});

describe("measurePair", () => {
  const sample = {
    black: "oklch(0 0 0)",
    white: "oklch(1 0 0)",
    link: "var(--black)",
  };

  it("gives 21:1 for black on white", () => {
    const pair = {
      label: "",
      fg: { token: "black" },
      bg: [{ token: "white" }],
      min: 4.5,
      kind: "text",
    } as const;

    expect(measurePair(sample, pair)).toBeCloseTo(21, 1);
  });

  it("blends a translucent foreground into its background", () => {
    const pair = {
      label: "",
      fg: { token: "black", alpha: 0 },
      bg: [{ token: "white" }],
      min: 4.5,
      kind: "text",
    } as const;

    expect(measurePair(sample, pair)).toBeCloseTo(1, 5);
  });
});

describe("parseRootTokens", () => {
  it("resolves var() references and ignores comments", () => {
    const css = ":root { /* --x: oklch(0 0 0); */ --a: oklch(1 0 0); --b: var(--a); }";

    expect(parseRootTokens(css)).toEqual({ a: "oklch(1 0 0)", b: "oklch(1 0 0)" });
  });

  it("fails on a reference to a missing token", () => {
    expect(() => parseRootTokens(":root { --b: var(--nope); }")).toThrow("var(--nope)");
  });
});
