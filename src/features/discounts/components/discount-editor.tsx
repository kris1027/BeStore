import { ArrowLeftIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { utcToZonedInput } from "@/lib/dates";
import { centsToInput, type MoneyFormat } from "@/lib/money";

import type { DiscountCodeForEdit } from "../admin-queries";
import { adminDiscountsPath, discountOrdersPath } from "../paths";
import { CodeStatusBadge, DiscountTermsLabel, UsesLabel } from "./code-labels";
import { DeleteDiscountButton } from "./delete-discount-button";
import { DiscountCodeForm } from "./discount-code-form";

function BackLink() {
  return (
    <Link
      href={adminDiscountsPath}
      className="flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Discounts
    </Link>
  );
}

export function NewDiscountPage({
  currency,
  timeZone,
}: {
  readonly currency: string;
  readonly timeZone: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink />
        <h1 className="text-2xl font-semibold">New code</h1>
      </div>
      <Card className="max-w-2xl">
        <CardContent>
          <DiscountCodeForm currency={currency} timeZone={timeZone} />
        </CardContent>
      </Card>
    </>
  );
}

// spec 0014, AC-12 and AC-13: the form, the code's uses and discount given, the link to its
// orders, and Delete while it was never used.
export function DiscountEditor({
  code,
  money,
  timeZone,
}: {
  readonly code: DiscountCodeForEdit;
  readonly money: MoneyFormat;
  readonly timeZone: string;
}) {
  const { currency } = money;
  const values = {
    code: code.code,
    type: code.type,
    value: code.type === "percent" ? String(code.value) : centsToInput(code.value, currency),
    startsAt: code.startsAt === null ? "" : utcToZonedInput(code.startsAt, timeZone),
    endsAt: code.endsAt === null ? "" : utcToZonedInput(code.endsAt, timeZone),
    maxRedemptions: code.maxRedemptions === null ? "" : String(code.maxRedemptions),
    perCustomerLimit: code.perCustomerLimit === null ? "" : String(code.perCustomerLimit),
    minSubtotal:
      code.minSubtotalCents === null ? "" : centsToInput(code.minSubtotalCents, currency),
    active: code.active,
    note: code.note ?? "",
  };
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{code.code}</h1>
          <CodeStatusBadge status={code.status} />
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <DiscountCodeForm
              key={code.updatedAt}
              currency={currency}
              timeZone={timeZone}
              code={{ id: code.id, values, updatedAt: code.updatedAt, locked: code.redeemed }}
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Use</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Discount</dt>
                <dd>
                  <DiscountTermsLabel terms={code} money={money} />
                </dd>
                <dt className="text-muted-foreground">Uses</dt>
                <dd className="tabular-nums">
                  <UsesLabel uses={code.uses} max={code.maxRedemptions} />
                </dd>
                <dt className="text-muted-foreground">Discount given</dt>
                <dd>
                  <Price cents={code.discountGivenCents} />
                </dd>
              </dl>
              <Link
                href={discountOrdersPath(code.id)}
                className={buttonVariants({ variant: "outline", className: "self-start" })}
              >
                Orders with this code
              </Link>
            </CardContent>
          </Card>
          {code.redeemed ? null : <DeleteDiscountButton id={code.id} code={code.code} />}
        </div>
      </div>
    </>
  );
}

export function DiscountNotFound() {
  return (
    <>
      <BackLink />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h1>Code not found</h1>
          </EmptyTitle>
          <EmptyDescription>There is no code at this address.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href={adminDiscountsPath} className={buttonVariants({ variant: "outline" })}>
            Back to discounts
          </Link>
        </EmptyContent>
      </Empty>
    </>
  );
}
