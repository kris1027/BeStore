import "server-only";

import { z } from "zod";

import type { ActorType, OrderEventType, OrderStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logEmailMissing } from "@/lib/orders/log";
import {
  type DeliveryAddress,
  deliveryAddressColumns,
  withDeliveryAddress,
} from "@/lib/shipping/address";
import { stripeDashboardUrl } from "@/lib/stripe";

// Not cached: the admin always sees the live tables. Callers run requireAdmin() first.

export const ADMIN_ORDERS_PAGE_SIZE = 50;

// The default view: orders that took money. "All orders" adds pending and expired checkouts.
export const settledStatuses = ["paid", "shipped", "delivered", "cancelled"] as const;

const listParamsSchema = z.object({
  view: z.enum(["all"]).optional().catch(undefined),
  before: z.coerce.number().int().min(1).optional().catch(undefined),
});

export type AdminOrdersParams = { readonly all: boolean; readonly before: number | null };

export function parseAdminOrdersParams(params: Record<string, unknown>): AdminOrdersParams {
  const parsed = listParamsSchema.parse({ view: params.view, before: params.before });
  return { all: parsed.view === "all", before: parsed.before ?? null };
}

export type AdminOrderRow = {
  readonly id: string;
  readonly number: number;
  readonly createdAt: Date;
  // null only on a purged order (piiPurgedAt set); anything else is a bug the list shows (AC-9).
  readonly email: string | null;
  // spec 0008, AC-8: set once the PII purge blanked this expired order.
  readonly piiPurgedAt: Date | null;
  readonly status: OrderStatus;
  readonly needsAttention: boolean;
  readonly itemCount: number;
  readonly currency: string;
  readonly totalCents: number;
  // "<full name>, <city>", or null for an order with no address (spec 0007, AC-12).
  readonly shipTo: string | null;
};

export type AdminOrdersPage = {
  readonly rows: readonly AdminOrderRow[];
  // The `before` value of the next, older page, or null on the last page.
  readonly olderBefore: number | null;
};

// spec 0006, AC-12: newest first, 50 at a time. Keyset paging on the order number (assigned in
// creation order), so a page stays stable while new orders arrive.
export async function getAdminOrders(params: AdminOrdersParams): Promise<AdminOrdersPage> {
  const orders = await db.order.findMany({
    where: {
      ...(params.all ? {} : { status: { in: [...settledStatuses] } }),
      ...(params.before === null ? {} : { number: { lt: params.before } }),
    },
    orderBy: { number: "desc" },
    take: ADMIN_ORDERS_PAGE_SIZE + 1,
    select: {
      id: true,
      number: true,
      createdAt: true,
      email: true,
      piiPurgedAt: true,
      status: true,
      needsAttention: true,
      currency: true,
      totalCents: true,
      shipFullName: true,
      shipCity: true,
      lines: { select: { quantity: true } },
    },
  });
  const page = orders.slice(0, ADMIN_ORDERS_PAGE_SIZE);
  const last = page.at(-1);
  // spec 0008, AC-9: one broken row shows "Email missing" instead of taking the list down.
  for (const order of page) {
    if (order.email === null && order.piiPurgedAt === null) logEmailMissing(order.id);
  }
  return {
    rows: page.map(({ lines, shipFullName, shipCity, ...order }) => ({
      ...order,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      shipTo: shipFullName !== null && shipCity !== null ? `${shipFullName}, ${shipCity}` : null,
    })),
    olderBefore: orders.length > ADMIN_ORDERS_PAGE_SIZE && last ? last.number : null,
  };
}

export type AdminOrderDetail = {
  readonly number: number;
  readonly status: OrderStatus;
  readonly needsAttention: boolean;
  // null only when piiPurgedAt is set: the query throws otherwise (spec 0008, AC-9).
  readonly email: string | null;
  readonly piiPurgedAt: Date | null;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  readonly phone: string | null;
  // null for an order made before spec 0007 (AC-11: "No address recorded").
  readonly address: DeliveryAddress | null;
  readonly stripe: {
    readonly sessionId: string | null;
    readonly sessionUrl: string | null;
    readonly paymentIntentId: string | null;
    readonly paymentUrl: string | null;
  };
  readonly lines: readonly {
    readonly id: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly sku: string;
    readonly unitPriceCents: number;
    readonly quantity: number;
    readonly lineTotalCents: number;
  }[];
  readonly events: readonly {
    readonly id: string;
    readonly type: OrderEventType;
    readonly fromStatus: OrderStatus | null;
    readonly toStatus: OrderStatus | null;
    readonly actorType: ActorType;
    readonly adminName: string | null;
    readonly message: string | null;
    readonly createdAt: Date;
  }[];
};

const orderNumberSchema = z.coerce.number().int().min(1001).max(2_147_483_647);

// spec 0006, AC-13: null for a malformed or unknown number (the page shows its not found state).
export async function getAdminOrder(numberParam: unknown): Promise<AdminOrderDetail | null> {
  const number = orderNumberSchema.safeParse(numberParam);
  if (!number.success) return null;

  const order = await db.order.findUnique({
    where: { number: number.data },
    select: {
      number: true,
      status: true,
      needsAttention: true,
      email: true,
      piiPurgedAt: true,
      currency: true,
      subtotalCents: true,
      discountCents: true,
      shippingCents: true,
      totalCents: true,
      createdAt: true,
      paidAt: true,
      phone: true,
      ...deliveryAddressColumns,
      stripeCheckoutSessionId: true,
      stripePaymentIntentId: true,
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productName: true,
          variantLabel: true,
          sku: true,
          unitPriceCents: true,
          quantity: true,
          lineTotalCents: true,
        },
      },
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          actorType: true,
          message: true,
          createdAt: true,
          admin: { select: { name: true } },
        },
      },
    },
  });
  if (!order) return null;
  // spec 0008, AC-9: the CHECK on orders keeps the email until the purge runs.
  if (order.email === null && order.piiPurgedAt === null) {
    throw new Error(`Order ${order.number} has no email and was never purged`);
  }

  const {
    stripeCheckoutSessionId: sessionId,
    stripePaymentIntentId: paymentIntentId,
    ...rest
  } = withDeliveryAddress(order, env.STORE_LOCALE);
  return {
    ...rest,
    stripe: {
      sessionId,
      sessionUrl: sessionId === null ? null : stripeDashboardUrl({ sessionId }),
      paymentIntentId,
      paymentUrl: paymentIntentId === null ? null : stripeDashboardUrl({ paymentIntentId }),
    },
    events: order.events.map(({ admin, ...event }) => ({
      ...event,
      adminName: admin?.name ?? null,
    })),
  };
}
