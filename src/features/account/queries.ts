import "server-only";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  type DeliveryAddress,
  deliveryAddressColumns,
  withDeliveryAddress,
} from "@/lib/shipping/address";

import type { OrderStatus } from "@/generated/prisma/enums";

import {
  isVisibleStatus,
  ORDERS_PER_PAGE,
  type VisibleStatus,
  visibleStatuses,
} from "./order-view";

// Every query here filters by the customer id from requireCustomer(), never one from the browser
// (spec 0012, Security model). Prices and totals come from the order snapshot, never the catalog.

const visibleWhere = { paidAt: { not: null }, status: { in: [...visibleStatuses] } };

// The where clause above guarantees both; a row without them is a bug.
function asVisible<T extends { readonly paidAt: Date | null; readonly status: OrderStatus }>(
  row: T,
): Omit<T, "paidAt" | "status"> & { readonly paidAt: Date; readonly status: VisibleStatus } {
  const { paidAt, status } = row;
  if (paidAt === null || !isVisibleStatus(status)) {
    throw new Error("An account order without paid_at or with a hidden status");
  }
  return { ...row, paidAt, status };
}

export type AccountOrderRow = {
  readonly number: number;
  readonly paidAt: Date;
  readonly status: VisibleStatus;
  readonly itemCount: number;
  readonly totalCents: number;
  readonly currency: string;
};

export type AccountOrderPage = {
  readonly orders: readonly AccountOrderRow[];
  readonly page: number;
  readonly hasNext: boolean;
};

// spec 0012, AC-11: paid orders, newest paid_at first (ties by id), 20 a page.
export async function listAccountOrders(
  customerId: string,
  page: number,
): Promise<AccountOrderPage> {
  const rows = await db.order.findMany({
    where: { customerId, ...visibleWhere },
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ORDERS_PER_PAGE,
    take: ORDERS_PER_PAGE + 1,
    select: {
      id: true,
      number: true,
      paidAt: true,
      status: true,
      totalCents: true,
      currency: true,
    },
  });
  const shown = rows.slice(0, ORDERS_PER_PAGE);
  const counts = await db.orderLine.groupBy({
    by: ["orderId"],
    where: { orderId: { in: shown.map((row) => row.id) } },
    _sum: { quantity: true },
  });
  const itemCounts = new Map(counts.map((count) => [count.orderId, count._sum.quantity ?? 0]));
  return {
    page,
    hasNext: rows.length > ORDERS_PER_PAGE,
    orders: shown.map((row) => {
      const { id, ...visible } = asVisible(row);
      return { ...visible, itemCount: itemCounts.get(id) ?? 0 };
    }),
  };
}

export type AccountOrder = {
  readonly number: number;
  readonly paidAt: Date;
  readonly status: VisibleStatus;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  // spec 0014, AC-15: the code's snapshot text, or null.
  readonly discountCode: string | null;
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly refundedCents: number;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  // null for an order made before spec 0007.
  readonly address: DeliveryAddress | null;
  readonly lines: readonly {
    readonly id: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
    readonly unitPriceCents: number;
    readonly lineTotalCents: number;
  }[];
};

// spec 0012, AC-12 and AC-13: one order, looked up by number and customer together. Another
// customer's order, no one's, and a hidden status all read as null: the same not found.
export async function getAccountOrder(
  customerId: string,
  number: number,
): Promise<AccountOrder | null> {
  const order = await db.order.findFirst({
    where: { number, customerId, ...visibleWhere },
    select: {
      number: true,
      paidAt: true,
      status: true,
      currency: true,
      subtotalCents: true,
      discountCents: true,
      discountCode: true,
      shippingCents: true,
      totalCents: true,
      refundedCents: true,
      carrier: true,
      trackingNumber: true,
      ...deliveryAddressColumns,
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productName: true,
          variantLabel: true,
          quantity: true,
          unitPriceCents: true,
          lineTotalCents: true,
        },
      },
    },
  });
  if (!order) return null;
  return asVisible(withDeliveryAddress(order, env.STORE_LOCALE));
}

export type AccountSettings = {
  readonly name: string | null;
  readonly phone: string | null;
  // Paid but not shipped yet: the delete dialog warns about them (AC-20).
  readonly openOrders: number;
};

// spec 0012, AC-18 and AC-20.
export async function getAccountSettings(customerId: string): Promise<AccountSettings> {
  const [profile, openOrders] = await Promise.all([
    db.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { name: true, phone: true },
    }),
    db.order.count({ where: { customerId, status: "paid" } }),
  ]);
  return { ...profile, openOrders };
}
