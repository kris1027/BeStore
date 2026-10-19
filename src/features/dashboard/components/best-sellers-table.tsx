import Link from "next/link";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, type MoneyFormat } from "@/lib/money";

import { adminProductPath } from "../paths";
import type { BestSeller } from "../queries";

// spec 0015, AC-9: the top 10 products by net units in the window.
export function BestSellersTable({
  rows,
  hiddenGroups,
  money,
}: {
  readonly rows: readonly BestSeller[];
  readonly hiddenGroups: number;
  readonly money: MoneyFormat;
}) {
  const units = new Intl.NumberFormat(money.locale);
  return (
    <section aria-labelledby="best-sellers-heading" className="flex flex-col gap-4">
      <h2 id="best-sellers-heading" className="text-lg font-semibold">
        Best sellers
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No products sold in this period.
        </p>
      ) : (
        <Table>
          <TableCaption className="sr-only">Top 10 products by net units sold</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Product</TableHead>
              <TableHead scope="col" className="text-right">
                Net units
              </TableHead>
              <TableHead scope="col" className="text-right">
                Sales
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.productId ?? `name:${row.name}`}>
                <TableCell className="whitespace-normal">
                  {row.productId !== null ? (
                    <Link
                      href={adminProductPath(row.productId)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {units.format(row.netUnits)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.salesCents, money)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {hiddenGroups > 0 ? (
        <p className="text-sm text-muted-foreground">
          Units refunded for products not listed here also come off Net units sold.
        </p>
      ) : null}
    </section>
  );
}
