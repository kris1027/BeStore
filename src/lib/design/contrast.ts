import { converter, parse, wcagContrast } from "culori";

export type Tokens = Readonly<Record<string, string>>;

// A color as the components use it: a token, optionally at an opacity (`bg-destructive/10`),
// painted over the layers beneath it.
export type Layer = { readonly token: string; readonly alpha?: number };

export type ContrastPair = {
  readonly label: string;
  readonly fg: Layer;
  // Top layer first, down to an opaque surface.
  readonly bg: readonly Layer[];
  readonly min: 3 | 4.5;
  readonly kind: "text" | "large text" | "control";
};

// Every text pair and control boundary the components use (spec 0003, AC-3).
export const contrastPairs: readonly ContrastPair[] = [
  text("Body text", "foreground", ["background"]),
  text("Body text on muted", "foreground", ["muted"]),
  text("Card text", "card-foreground", ["card"]),
  text("Popover text", "popover-foreground", ["popover"]),
  text("Primary button", "primary-foreground", ["primary"]),
  { ...text("Primary button, hover", "primary-foreground", []), bg: over("primary", 0.8) },
  text("Secondary fill", "secondary-foreground", ["secondary"]),
  text("Accent fill (hover, menus)", "accent-foreground", ["accent"]),
  text("Secondary text", "muted-foreground", ["background"]),
  text("Secondary text on muted", "muted-foreground", ["muted"]),
  text("Secondary text in the sidebar", "muted-foreground", ["sidebar"]),
  text("Error text", "destructive", ["background"]),
  { ...text("Destructive button and badge", "destructive", []), bg: over("destructive", 0.1) },
  { ...text("Destructive button, hover", "destructive", []), bg: over("destructive", 0.2) },
  {
    ...text("Destructive alert description", "destructive", ["card"]),
    fg: { token: "destructive", alpha: 0.9 },
  },
  text("White text on destructive", "background", ["destructive"]),
  text("Sidebar text", "sidebar-foreground", ["sidebar"]),
  {
    ...text("Sidebar group label", "sidebar-foreground", ["sidebar"]),
    fg: { token: "sidebar-foreground", alpha: 0.7 },
  },
  text("Sidebar active item", "sidebar-accent-foreground", ["sidebar-accent"]),
  text("Sidebar primary", "sidebar-primary-foreground", ["sidebar-primary"]),
  control("Form control border", "input", "background"),
  control("Focus ring", "ring", "background"),
  control("Focus ring in the sidebar", "sidebar-ring", "sidebar"),
];

function text(label: string, fg: string, bg: readonly string[]): ContrastPair {
  return { label, fg: { token: fg }, bg: bg.map((token) => ({ token })), min: 4.5, kind: "text" };
}

function control(label: string, fg: string, bg: string): ContrastPair {
  return { label, fg: { token: fg }, bg: [{ token: bg }], min: 3, kind: "control" };
}

function over(token: string, alpha: number): readonly Layer[] {
  return [{ token, alpha }, { token: "background" }];
}

// Reads the custom properties of the first `:root { … }` block, resolving `var(--x)` references.
export function parseRootTokens(css: string): Tokens {
  const block = /:root\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1];
  if (block === undefined) throw new Error("No :root block in the stylesheet");
  const raw = Object.fromEntries(
    [...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]?.trim()]),
  ) as Record<string, string>;
  const resolve = (value: string, depth = 0): string => {
    const ref = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
    if (ref === undefined) return value;
    const target = raw[ref];
    if (target === undefined || depth > 5) throw new Error(`Unresolvable token var(--${ref})`);
    return resolve(target, depth + 1);
  };
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, resolve(value)]));
}

const toRgb = converter("rgb");

type Rgb = { r: number; g: number; b: number };

function tokenRgb(tokens: Tokens, token: string): Rgb {
  const value = tokens[token];
  const color = value === undefined ? undefined : parse(value);
  if (color === undefined) throw new Error(`Token --${token} is missing or not a color`);
  const { r, g, b } = toRgb(color);
  return { r, g, b };
}

// Browsers composite opacity in gamma encoded sRGB, so blend there.
function composite(tokens: Tokens, layers: readonly Layer[]): Rgb {
  const bottom = layers.at(-1);
  if (bottom === undefined) throw new Error("A background needs at least one layer");
  return layers
    .slice(0, -1)
    .reduceRight((below, layer) => blend(tokenRgb(tokens, layer.token), below, layer.alpha ?? 1), {
      ...tokenRgb(tokens, bottom.token),
    });
}

function blend(top: Rgb, below: Rgb, alpha: number): Rgb {
  const mix = (a: number, b: number) => a * alpha + b * (1 - alpha);
  return { r: mix(top.r, below.r), g: mix(top.g, below.g), b: mix(top.b, below.b) };
}

export function measurePair(tokens: Tokens, pair: ContrastPair): number {
  const bg = composite(tokens, pair.bg);
  const fg = composite(tokens, [pair.fg, ...pair.bg]);
  return wcagContrast({ mode: "rgb", ...fg }, { mode: "rgb", ...bg });
}
