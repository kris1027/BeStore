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
import { type DateFormat, formatDateTime } from "@/lib/dates";

import { STOCK_HISTORY_LIMIT, type StockHistoryRow } from "../../admin-queries";
import { formatDelta } from "../../stock";

const kindLabels: Record<StockHistoryRow["kind"], string> = {
  initial: "Opening count",
  adjustment: "Adjustment",
  sale: "Sale",
  // spec 0010: a refund put units back; the admin who refunded is the actor.
  return: "Refund return",
};

function Who({ actor }: { readonly actor: StockHistoryRow["actor"] }) {
  switch (actor.type) {
    case "admin":
      return actor.name;
    case "order":
      return (
        <Link href={`/admin/orders/${actor.number}`} className="underline underline-offset-4">
          Order #{actor.number}
        </Link>
      );
    case "system":
      return "System";
  }
}

// spec 0009, AC-11: the latest movements of this product's variants, newest first.
export function StockHistory({
  rows,
  dateFormat,
}: {
  readonly rows: readonly StockHistoryRow[];
  readonly dateFormat: DateFormat;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No stock changes recorded yet.</p>;
  }
  return (
    <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Stock history" }}>
      <TableCaption className="sr-only">
        Stock history, the latest {STOCK_HISTORY_LIMIT} changes, newest first
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Variant</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right">After</TableHead>
          <TableHead>Who</TableHead>
          <TableHead>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <time dateTime={row.createdAt.toISOString()}>
                {formatDateTime(row.createdAt, dateFormat)}
              </time>
            </TableCell>
            <TableCell>{row.variantLabel}</TableCell>
            <TableCell>{kindLabels[row.kind]}</TableCell>
            <TableCell className="text-right tabular-nums">{formatDelta(row.delta)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.stockAfter}</TableCell>
            <TableCell>
              <Who actor={row.actor} />
            </TableCell>
            <TableCell className="max-w-64 whitespace-normal">{row.note}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
