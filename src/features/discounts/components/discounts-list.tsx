import { PlusIcon, SearchIcon, TicketPercentIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SEARCH_MAX_LENGTH } from "@/lib/admin-search";
import { type DateFormat, formatDateTime } from "@/lib/dates";
import { codeStatusLabels } from "@/lib/discounts/rule";
import type { MoneyFormat } from "@/lib/money";

import { DISCOUNT_LIST_LIMIT, type DiscountCodeList } from "../admin-queries";
import { codeStatusFilters, type DiscountListParams, hasDiscountFilters } from "../list-params";
import {
  adminDiscountPath,
  adminDiscountsPath,
  discountOrdersPath,
  newDiscountPath,
} from "../paths";
import { CodeStatusBadge, DiscountTermsLabel, UsesLabel } from "./code-labels";
import { StatusFilter } from "./status-filter";

function NewCodeLink() {
  return (
    <Link href={newDiscountPath} className={buttonVariants()}>
      <PlusIcon data-icon="inline-start" aria-hidden="true" />
      New code
    </Link>
  );
}

// spec 0014, AC-10: every code newest first, with its status, uses and the discount it gave.
export function DiscountsList({
  list,
  params,
  dateFormat,
  money,
}: {
  readonly list: DiscountCodeList;
  readonly params: DiscountListParams;
  readonly dateFormat: DateFormat;
  readonly money: MoneyFormat;
}) {
  const filtered = hasDiscountFilters(params);
  const when = (date: Date | null, empty: string) =>
    date === null ? (
      <span className="text-muted-foreground">{empty}</span>
    ) : (
      formatDateTime(date, dateFormat)
    );
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Discounts</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Promo codes customers type at checkout. Newest first.
          </p>
        </div>
        {list.rows.length > 0 || filtered ? <NewCodeLink /> : null}
      </div>
      {list.rows.length > 0 || filtered ? (
        <form
          aria-label="Find codes"
          action={adminDiscountsPath}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex min-w-48 flex-1 flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="discounts-q">Code</Label>
            <Input
              id="discounts-q"
              type="search"
              name="q"
              defaultValue={params.q}
              maxLength={SEARCH_MAX_LENGTH}
              autoComplete="off"
            />
          </div>
          <StatusFilter
            value={params.status ?? ""}
            items={[
              { value: "", label: "Any" },
              ...codeStatusFilters.map((status) => ({
                value: status,
                label: codeStatusLabels[status],
              })),
            ]}
          />
          <Button type="submit" variant="outline">
            <SearchIcon data-icon="inline-start" aria-hidden="true" />
            Find codes
          </Button>
        </form>
      ) : null}
      {list.rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TicketPercentIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>{filtered ? "No codes match these filters." : "No codes yet"}</h2>
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another search, or clear the filters."
                : "Create a code, then share it with customers to type at checkout."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Link href={adminDiscountsPath} className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              <NewCodeLink />
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3">
            {list.truncated ? (
              <p className="text-sm text-muted-foreground">
                Showing the newest {DISCOUNT_LIST_LIMIT} codes
              </p>
            ) : null}
            <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Codes" }}>
              <TableCaption className="sr-only">Promo codes, newest first</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Uses</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead className="text-right">Discount given</TableHead>
                  <TableHead>
                    <span className="sr-only">Orders</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={adminDiscountPath(row.id)}
                        className="font-mono underline-offset-4 hover:underline"
                      >
                        {row.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <DiscountTermsLabel terms={row} money={money} />
                    </TableCell>
                    <TableCell>
                      <CodeStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <UsesLabel uses={row.uses} max={row.maxRedemptions} />
                    </TableCell>
                    <TableCell>{when(row.startsAt, "Not set")}</TableCell>
                    <TableCell>{when(row.endsAt, "No end")}</TableCell>
                    <TableCell className="text-right">
                      <Price cents={row.discountGivenCents} />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={discountOrdersPath(row.id)}
                        className="text-sm underline underline-offset-4"
                        aria-label={`Orders with ${row.code}`}
                      >
                        Orders
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
