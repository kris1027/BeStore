import Image from "next/image";
import { SearchIcon, ShoppingBagIcon, UserIcon } from "lucide-react";

import { storeContainer } from "@/components/layout/container";
import { StoreShell } from "@/components/layout/store-shell";
import { Price } from "@/components/price";
import { StoreFormatProvider } from "@/components/store-format-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { loadTokenReport } from "../tokens";
import { ComponentShowcase } from "./component-showcase";
import { ShowcaseSection } from "./showcase-section";

const demoNav = [
  { href: "/style-guide", label: "Style guide" },
  { href: "/style-guide/admin", label: "Admin shell" },
];

const demoFooterLinks = [
  { href: "/style-guide#colors", label: "Colors" },
  { href: "/style-guide#components", label: "Components" },
];

const typeScale = [
  { name: "Storefront h1", className: "font-heading text-4xl md:text-5xl" },
  { name: "Storefront h2", className: "font-heading text-3xl" },
  { name: "Storefront h3", className: "font-heading text-2xl" },
  { name: "Admin page title", className: "font-sans text-2xl font-semibold" },
  { name: "Body", className: "text-base" },
  { name: "Small", className: "text-sm" },
  { name: "Secondary", className: "text-sm text-muted-foreground" },
];

const spacing = [1, 2, 4, 6, 8, 12, 16];

function HeaderActions() {
  return (
    <>
      <Button variant="ghost" size="icon" className="size-11" aria-label="Search">
        <SearchIcon aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" className="size-11" aria-label="Account">
        <UserIcon aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" className="size-11" aria-label="Cart, 2 items">
        <ShoppingBagIcon aria-hidden="true" />
      </Button>
    </>
  );
}

export function StyleGuidePage() {
  const { colors, pairs } = loadTokenReport();

  return (
    <StoreShell navItems={demoNav} actions={<HeaderActions />} footerLinks={demoFooterLinks}>
      <div className={cn(storeContainer, "flex flex-col gap-16 py-12 md:py-16")}>
        <div className="flex max-w-2xl flex-col gap-3">
          <Badge variant="outline">Not shown in production</Badge>
          <h1 className="font-heading text-4xl md:text-5xl">Style guide</h1>
          <p className="text-lg text-muted-foreground">
            Every token, type style and component in one place. New pages compose these; they never
            invent a look. The rules behind them live in docs/design.md.
          </p>
        </div>

        <ShowcaseSection
          id="colors"
          level="h2"
          title="Colors"
          description="Near black on white; photos carry the color. Components use these semantic tokens only."
        >
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {colors.map(([name, value]) => (
              <li key={name} className="flex flex-col gap-2">
                <div
                  className="h-12 rounded-md border"
                  style={{ background: `var(--${name})` }}
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-sm">--{name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{value}</span>
                </div>
              </li>
            ))}
          </ul>
        </ShowcaseSection>

        <ShowcaseSection
          id="contrast"
          level="h2"
          title="Contrast"
          description="Measured from the stylesheet at build time. Text needs 4.5:1; control borders and the focus ring need 3:1."
        >
          <Table>
            <TableCaption>WCAG AA contrast for every token pair in use</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Pair</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Ratio</TableHead>
                <TableHead className="text-right">Needs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.map((pair) => (
                <TableRow key={pair.label}>
                  {/* Wraps instead of scrolling sideways on phones. */}
                  <TableCell className="whitespace-normal">{pair.label}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {pair.kind}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pair.ratio.toFixed(2)}:1
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pair.min}:1 {pair.ratio >= pair.min ? "✓" : "✗"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ShowcaseSection>

        <ShowcaseSection
          id="type"
          level="h2"
          title="Typography"
          description="Newsreader for storefront headings and the wordmark; Inter for body text, controls and all admin text. Body text is never below 16px."
        >
          <dl className="flex flex-col gap-6">
            {typeScale.map((style) => (
              <div
                key={style.name}
                className="grid gap-1 md:grid-cols-[12rem_1fr] md:items-baseline md:gap-6"
              >
                <dt className="text-sm text-muted-foreground">{style.name}</dt>
                <dd className={style.className}>Quiet clothes for loud days</dd>
              </div>
            ))}
          </dl>
        </ShowcaseSection>

        <ShowcaseSection
          id="layout"
          level="h2"
          title="Layout, radius and images"
          description="Mobile first on Tailwind's 4px grid, gap for spacing, a 7xl container. Radius is small (0.25rem). Product images are 4:5."
        >
          <div className="grid gap-10 lg:grid-cols-3">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Spacing</p>
              <ul className="flex flex-col gap-2">
                {spacing.map((step) => (
                  <li key={step} className="flex items-center gap-3">
                    <span className="w-8 font-mono text-xs text-muted-foreground">{step}</span>
                    <span
                      className="h-3 rounded-sm bg-primary"
                      style={{ width: `calc(var(--spacing) * ${step})` }}
                      aria-hidden="true"
                    />
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Radius</p>
              <div className="flex flex-wrap gap-3">
                {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((radius) => (
                  <div key={radius} className="flex flex-col items-center gap-1">
                    <div className={cn("size-14 border bg-muted", radius)} aria-hidden="true" />
                    <span className="font-mono text-xs text-muted-foreground">{radius}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Product image (aspect-product, placeholder)</p>
              <div className="flex max-w-48 flex-col gap-2">
                <div className="relative aspect-product overflow-hidden rounded-md bg-muted">
                  <Image src="/placeholder.svg" alt="" fill className="object-cover" />
                </div>
                <p className="text-sm">Linen shirt</p>
                <Price cents={4900} className="text-sm text-muted-foreground" />
              </div>
            </div>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          id="money"
          level="h2"
          title="Money"
          description="Prices are integer minor units, formatted only by formatMoney and Price, in the store's locale and currency."
        >
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Store currency</dt>
            <dd className="text-right">
              <Price cents={1999} />
            </dd>
            <dt className="text-muted-foreground">JPY (no minor unit)</dt>
            <dd className="text-right">
              <Price cents={1999} currency="JPY" />
            </dd>
            <dt className="text-muted-foreground">Negative (refund)</dt>
            <dd className="text-right">
              <Price cents={-500} />
            </dd>
            <dt className="text-muted-foreground">pl-PL, PLN</dt>
            <dd className="text-right">
              <StoreFormatProvider locale="pl-PL" currency="PLN">
                <Price cents={1234567} />
              </StoreFormatProvider>
            </dd>
          </dl>
        </ShowcaseSection>

        <Separator />

        <section
          id="components"
          aria-labelledby="components-title"
          className="flex flex-col gap-12"
        >
          <div className="flex max-w-2xl flex-col gap-1">
            <h2 id="components-title" className="font-heading text-3xl">
              Components
            </h2>
            <p className="text-muted-foreground">
              shadcn/ui on Base UI, in src/components/ui. Each one in the states it has.
            </p>
          </div>
          <ComponentShowcase />
        </section>
      </div>
    </StoreShell>
  );
}
