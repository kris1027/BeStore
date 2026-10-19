import type { OrderStatus, RefundStatus } from "@/generated/prisma/enums";

import { testDb } from "./client";

// Builders for the sales dashboard suites (spec 0015): orders and refunds placed at exact
// instants, written straight to the tables the dashboard reads.

export type LineInput = {
  readonly productId?: string | null;
  readonly productName?: string;
  readonly quantity?: number;
  readonly lineTotalCents?: number;
};

let orderCounter = 0;

export async function paidOrder(input: {
  readonly paidAt: Date | null;
  readonly totalCents?: number;
  readonly currency?: string;
  readonly status?: OrderStatus;
  readonly lines?: readonly LineInput[];
}) {
  orderCounter += 1;
  const totalCents = input.totalCents ?? 1000;
  return testDb.order.create({
    data: {
      status: input.status ?? (input.paidAt === null ? "cancelled" : "paid"),
      email: `buyer${orderCounter}@example.com`,
      currency: input.currency ?? "EUR",
      subtotalCents: totalCents,
      totalCents,
      paidAt: input.paidAt,
      lines: {
        create: (input.lines ?? [{}]).map((line, index) => {
          const quantity = line.quantity ?? 1;
          const lineTotalCents = line.lineTotalCents ?? totalCents;
          // A CHECK keeps line_total = unit price × quantity − discount; any total fits this way.
          return {
            productId: line.productId ?? null,
            productName: line.productName ?? "Tee",
            sku: `SKU-${orderCounter}-${index}`,
            unitPriceCents: lineTotalCents,
            quantity,
            discountCents: lineTotalCents * (quantity - 1),
            lineTotalCents,
          };
        }),
      },
    },
    include: { lines: { orderBy: { sku: "asc" } } },
  });
}

export async function refund(input: {
  readonly orderId: string;
  readonly amountCents: number;
  readonly succeededAt: Date | null;
  readonly status?: RefundStatus;
  readonly lines?: readonly { readonly orderLineId: string; readonly quantity: number }[];
}) {
  const status = input.status ?? (input.succeededAt === null ? "pending" : "succeeded");
  return testDb.refund.create({
    data: {
      orderId: input.orderId,
      amountCents: input.amountCents,
      status,
      succeededAt: status === "succeeded" ? input.succeededAt : null,
      actorType: "system",
      lines: { create: [...(input.lines ?? [])] },
    },
  });
}
