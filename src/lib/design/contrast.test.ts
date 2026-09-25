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

  it("composites a translucent background over the layer beneath it", () => {
    const pair = {
      label: "",
      fg: { token: "black" },
      bg: [{ token: "black", alpha: 0.5 }, { token: "white" }],
      min: 4.5,
      kind: "text",
    } as const;

    // Black at 50% over white is mid grey in gamma encoded sRGB, not black and not white.
    const ratio = measurePair(sample, pair);
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(21);
    expect(ratio).toBeCloseTo(
      measurePair(
        { ...sample, grey: "rgb(127.5 127.5 127.5)" },
        {
          ...pair,
          bg: [{ token: "grey" }],
        },
      ),
      5,
    );
  });

  it("measures through a var() alias", () => {
    const pair = {
      label: "",
      fg: { token: "link" },
      bg: [{ token: "white" }],
      min: 4.5,
      kind: "text",
    } as const;

    expect(
      measurePair(
        parseRootTokens(
          `:root { --black: oklch(0 0 0); --white: oklch(1 0 0); --link: var(--black); }`,
        ),
        pair,
      ),
    ).toBeCloseTo(21, 1);
  });

  it("fails naming a token that is missing", () => {
    const pair = {
      label: "",
      fg: { token: "nope" },
      bg: [{ token: "white" }],
      min: 4.5,
      kind: "text",
    } as const;

    expect(() => measurePair(sample, pair)).toThrow("--nope");
  });

  it("fails on a token that is not a color", () => {
    const pair = {
      label: "",
      fg: { token: "black" },
      bg: [{ token: "size" }],
      min: 4.5,
      kind: "text",
    } as const;

    expect(() => measurePair({ ...sample, size: "1rem" }, pair)).toThrow("--size");
  });

  it("fails on a pair with no background layer", () => {
    const pair = { label: "", fg: { token: "black" }, bg: [], min: 4.5, kind: "text" } as const;

    expect(() => measurePair(sample, pair)).toThrow("at least one layer");
  });
});

// covers: AC-3 (a pair naming a token the stylesheet lacks would fail loudly, not pass silently)
describe("contrastPairs", () => {
  it("only names tokens that exist in app/globals.css", () => {
    const names = contrastPairs.flatMap((pair) => [pair.fg.token, ...pair.bg.map((l) => l.token)]);

    expect(names.filter((name) => tokens[name] === undefined)).toEqual([]);
  });

  it("holds text to 4.5:1 and control boundaries to 3:1", () => {
    for (const pair of contrastPairs) {
      expect(pair.min).toBe(pair.kind === "control" ? 3 : 4.5);
    }
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

  it("fails on a stylesheet with no :root block", () => {
    expect(() => parseRootTokens("body { color: red; }")).toThrow("No :root block");
  });

  it("fails on a reference cycle instead of looping forever", () => {
    expect(() => parseRootTokens(":root { --a: var(--b); --b: var(--a); }")).toThrow(
      "Unresolvable",
    );
  });

  it("reads only the first :root block", () => {
    const css = ":root { --a: oklch(1 0 0); } :root { --b: oklch(0 0 0); }";

    expect(parseRootTokens(css)).toEqual({ a: "oklch(1 0 0)" });
  });
});
