"use client";

import { TableIcon } from "lucide-react";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import { useStoreFormat } from "@/components/store-format-provider";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";

import type { BucketUnit } from "../period";

export type ChartRow = {
  readonly key: string;
  readonly label: string;
  readonly grossCents: number;
  readonly refundCents: number;
  readonly netCents: number;
};

// The darkest chart grays: bars stay visible against the card (design.md reserves --chart-*
// for this page).
const chartConfig = {
  netCents: { label: "Net revenue", color: "var(--chart-4)" },
} satisfies ChartConfig;

// spec 0015, AC-11 and AC-12: net revenue per bucket. The SVG is hidden from screen readers;
// the same numbers are one button away as a table.
export function RevenueChart({
  unit,
  rows,
}: {
  readonly unit: BucketUnit;
  readonly rows: readonly ChartRow[];
}) {
  const format = useStoreFormat();
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const heading = `Net revenue per ${unit}`;
  const money = (cents: number) => formatMoney(cents, format);

  return (
    <section aria-labelledby={`${tableId}-heading`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${tableId}-heading`} className="text-lg font-semibold">
          {heading}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((shown) => !shown)}
        >
          <TableIcon data-icon="inline-start" aria-hidden="true" />
          {showTable ? "Hide table" : "Show as table"}
        </Button>
      </div>
      <div aria-hidden="true">
        {/* A fixed height, so the chart renders without waiting to measure its parent. */}
        <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
          {/* accessibilityLayer off: it makes the SVG focusable, inside an aria-hidden box. */}
          <BarChart
            data={[...rows]}
            accessibilityLayer={false}
            margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={88}
              allowDecimals={false}
              tickFormatter={(value: number) => money(Math.round(value))}
            />
            <ReferenceLine y={0} stroke="var(--input)" />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <div className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">Net revenue</span>
                      <span className="font-medium text-foreground tabular-nums">
                        {money(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="netCents" fill="var(--color-netCents)" radius={2} />
          </BarChart>
        </ChartContainer>
      </div>
      <div id={tableId} hidden={!showTable}>
        {showTable ? (
          <Table>
            <TableCaption>{heading}, with gross sales and refunds</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Period</TableHead>
                <TableHead scope="col" className="text-right">
                  Gross
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Refunds
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Net
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableHead scope="row" className="font-normal">
                    {row.label}
                  </TableHead>
                  <TableCell className="text-right tabular-nums">{money(row.grossCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.refundCents)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(row.netCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </section>
  );
}
