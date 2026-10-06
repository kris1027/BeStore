import "server-only";

import { z } from "zod";

import type {
  ActorType,
  OrderEventType,
  OrderStatus,
  RefundStatus,
} from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { parseCalendarDay, zonedDayStart } from "@/lib/dates";
import { db } from "@/lib/db";
import { escapeLike } from "@/lib/like";
import { env } from "@/lib/env";
import { logEmailMissing } from "@/lib/orders/log";
import {
  type DeliveryAddress,
  deliveryAddressColumns,
  withDeliveryAddress,
} from "@/lib/shipping/address";
import { stripeDashboardUrl } from "@/lib/stripe";

import { type AdminOrdersParams, searchNumber } from "./list-params";
import {
  type AllowedActions,
  allowedActions,
  canCheckWithStripe,
  isInFlight,
} from "./order-actions";
import {
  allocateReturns,
  type RefundLedger,
  refundableUnits,
  refundState,
  type RefundState,
  remainingCents,
  shippingRefundable,
} from "./refund-math";

// Not cached: the admin always sees the live tables. Callers run requireAdmin() first.

export const ADMIN_ORDERS_PAGE_SIZE = 50;

// The default view: orders that took money. "All orders" adds pending and expired checkouts.
export const settledStatuses = ["paid", "shipped", "delivered", "cancelled"] as const;

export { type AdminOrdersParams, parseAdminOrdersParams } from "./list-params";

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
  readonly refundedCents: number;
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
      AND: [
        ...filterWhere(params),
        ...(params.before === null ? [] : [{ number: { lt: params.before } }]),
      ],
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
      refundedCents: true,
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

export type AdminOrderLine = {
  readonly id: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly sku: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
  readonly lineTotalCents: number;
  // spec 0010: units no refund (that did not fail) covers yet.
  readonly refundableUnits: number;
  // Units that could still go back to stock (what the sale took, less returns and restocks
  // already asked for), for the refund form's warning (AC-13).
  readonly restockableUnits: number;
};

export type AdminRefund = {
  readonly id: string;
  readonly amountCents: number;
  readonly status: RefundStatus;
  // The admin's name, or null for a refund made in the Stripe dashboard.
  readonly adminName: string | null;
  readonly reason: string | null;
  readonly includesShipping: boolean;
  readonly createdAt: Date;
  readonly succeededAt: Date | null;
  // AC-17: a pending refund older than 2 minutes offers "Check with Stripe".
  readonly canCheck: boolean;
  readonly lines: readonly {
    readonly id: string;
    readonly sku: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
    readonly restock: boolean;
    readonly returnedQuantity: number;
  }[];
};

// spec 0010, AC-1 and AC-2: every filter is one AND term.
function filterWhere(params: AdminOrdersParams): Prisma.OrderWhereInput[] {
  const terms: Prisma.OrderWhereInput[] = [];
  if (params.q !== "") {
    // Prisma's contains passes LIKE wildcards through, so the query is escaped to match them
    // literally ("50%" is not "50 and anything").
    const contains = escapeLike(params.q);
    const number = searchNumber(params.q);
    terms.push({
      OR: [
        ...(number === null ? [] : [{ number }]),
        { email: { contains, mode: "insensitive" } },
        { customerName: { contains, mode: "insensitive" } },
        { shipFullName: { contains, mode: "insensitive" } },
      ],
    });
  }
  if (params.status === "settled") terms.push({ status: { in: [...settledStatuses] } });
  else if (params.status !== "all") terms.push({ status: params.status });
  if (params.attention) terms.push({ needsAttention: true });
  if (params.refund === "none") terms.push({ refundedCents: 0 });
  if (params.refund === "full") {
    terms.push({ refundedCents: { gt: 0, gte: db.order.fields.totalCents } });
  }
  if (params.refund === "partial") {
    terms.push({ refundedCents: { gt: 0, lt: db.order.fields.totalCents } });
  }
  // Whole days in the store's time zone: from the start of `from` to the start of the day
  // after `to`.
  const from = params.from === null ? null : parseCalendarDay(params.from);
  const to = params.to === null ? null : parseCalendarDay(params.to);
  if (from) terms.push({ createdAt: { gte: zonedDayStart(from, env.STORE_TIMEZONE) } });
  if (to) {
    const next = new Date(Date.UTC(to.y, to.m - 1, to.d + 1));
    terms.push({
      createdAt: {
        lt: zonedDayStart(
          { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() },
          env.STORE_TIMEZONE,
        ),
      },
    });
  }
  return terms;
}

export type AdminOrderDetail = {
  readonly number: number;
  readonly status: OrderStatus;
  readonly needsAttention: boolean;
  // The form's copy for the stale check (spec 0010, AC-8), to the millisecond.
  readonly updatedAt: string;
  // null only when piiPurgedAt is set: the query throws otherwise (spec 0008, AC-9).
  readonly email: string | null;
  readonly piiPurgedAt: Date | null;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly refundedCents: number;
  readonly refundState: RefundState;
  readonly remainingCents: number;
  readonly shippingRefundable: boolean;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  readonly shippedAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly phone: string | null;
  // null for an order made before spec 0007 (AC-11: "No address recorded").
  readonly address: DeliveryAddress | null;
  readonly stripe: {
    readonly sessionId: string | null;
    readonly sessionUrl: string | null;
    readonly paymentIntentId: string | null;
    readonly paymentUrl: string | null;
  };
  readonly lines: readonly AdminOrderLine[];
  // The rows the refund form's suggestion is computed from, with the same pure math the action
  // checks against.
  readonly math: RefundLedger;
  readonly refunds: readonly AdminRefund[];
  readonly allowed: AllowedActions;
  readonly refundInFlight: boolean;
  // What the attention banner lists: system notes and failures since the flag was last cleared.
  readonly attentionReasons: readonly { readonly id: string; readonly message: string }[];
  // Newest first (spec 0010, AC-21).
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

// spec 0006, AC-13 and spec 0010, AC-21: null for a malformed or unknown number (the page shows
// its not found state).
export async function getAdminOrder(
  numberParam: unknown,
  nowMs: number = Date.now(),
): Promise<AdminOrderDetail | null> {
  const number = orderNumberSchema.safeParse(numberParam);
  if (!number.success) return null;

  const order = await db.order.findUnique({
    where: { number: number.data },
    select: {
      id: true,
      number: true,
      status: true,
      needsAttention: true,
      updatedAt: true,
      email: true,
      piiPurgedAt: true,
      currency: true,
      subtotalCents: true,
      discountCents: true,
      shippingCents: true,
      totalCents: true,
      refundedCents: true,
      createdAt: true,
      paidAt: true,
      shippedAt: true,
      deliveredAt: true,
      cancelledAt: true,
      carrier: true,
      trackingNumber: true,
      phone: true,
      ...deliveryAddressColumns,
      stripeCheckoutSessionId: true,
      stripePaymentIntentId: true,
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          variantId: true,
          productName: true,
          variantLabel: true,
          sku: true,
          unitPriceCents: true,
          quantity: true,
          lineTotalCents: true,
        },
      },
      refunds: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          amountCents: true,
          status: true,
          reason: true,
          includesShipping: true,
          stripeRefundId: true,
          createdAt: true,
          succeededAt: true,
          admin: { select: { name: true } },
          lines: {
            orderBy: { orderLineId: "asc" },
            select: {
              id: true,
              orderLineId: true,
              quantity: true,
              restock: true,
              restocked: true,
              returnedQuantity: true,
              orderLine: { select: { sku: true, productName: true, variantLabel: true } },
            },
          },
        },
      },
      stockMovements: {
        where: { kind: { in: ["sale", "return"] } },
        select: { variantId: true, kind: true, delta: true },
      },
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

  const math: RefundLedger = {
    totalCents: order.totalCents,
    shippingCents: order.shippingCents,
    lines: order.lines.map(({ id, quantity, lineTotalCents }) => ({
      id,
      quantity,
      lineTotalCents,
    })),
    refunds: order.refunds.map((refund) => ({
      status: refund.status,
      amountCents: refund.amountCents,
      includesShipping: refund.includesShipping,
      lines: refund.lines.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })),
    })),
  };
  const remaining = remainingCents(math);
  const refundInFlight = order.refunds.some((refund) => isInFlight(refund, nowMs));
  const restockable = restockableUnits(order, math);

  // The banner lists why the order was flagged since an admin last cleared it.
  const lastCleared = order.events.findIndex((event) => event.type === "attention_cleared");
  const sinceCleared = lastCleared < 0 ? order.events : order.events.slice(0, lastCleared);
  const attentionReasons = sinceCleared.flatMap((event) =>
    event.actorType === "system" &&
    event.message !== null &&
    (event.type === "note" || event.type === "stock_shortfall" || event.type === "refund_failed")
      ? [{ id: event.id, message: event.message }]
      : [],
  );

  const sessionId = order.stripeCheckoutSessionId;
  const paymentIntentId = order.stripePaymentIntentId;
  return {
    number: order.number,
    status: order.status,
    needsAttention: order.needsAttention,
    updatedAt: order.updatedAt.toISOString(),
    email: order.email,
    piiPurgedAt: order.piiPurgedAt,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    refundedCents: order.refundedCents,
    refundState: refundState(order.totalCents, order.refundedCents),
    remainingCents: remaining,
    shippingRefundable: shippingRefundable(math),
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    phone: order.phone,
    address: withDeliveryAddress(order, env.STORE_LOCALE).address,
    stripe: {
      sessionId,
      sessionUrl: sessionId === null ? null : stripeDashboardUrl({ sessionId }),
      paymentIntentId,
      paymentUrl: paymentIntentId === null ? null : stripeDashboardUrl({ paymentIntentId }),
    },
    lines: order.lines.map((line) => ({
      id: line.id,
      productName: line.productName,
      variantLabel: line.variantLabel,
      sku: line.sku,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
      refundableUnits: refundableUnits(math, line),
      restockableUnits: restockable.get(line.id) ?? 0,
    })),
    math,
    refunds: order.refunds.map((refund) => ({
      id: refund.id,
      amountCents: refund.amountCents,
      status: refund.status,
      adminName: refund.admin?.name ?? null,
      reason: refund.reason,
      includesShipping: refund.includesShipping,
      createdAt: refund.createdAt,
      succeededAt: refund.succeededAt,
      canCheck: canCheckWithStripe(refund, nowMs),
      lines: refund.lines.map((line) => ({
        id: line.id,
        sku: line.orderLine.sku,
        productName: line.orderLine.productName,
        variantLabel: line.orderLine.variantLabel,
        quantity: line.quantity,
        restock: line.restock,
        returnedQuantity: line.returnedQuantity,
      })),
    })),
    allowed: allowedActions(
      {
        status: order.status,
        needsAttention: order.needsAttention,
        remainingCents: remaining,
        hasPayment: paymentIntentId !== null,
      },
      refundInFlight,
    ),
    refundInFlight,
    attentionReasons,
    events: order.events.map(({ admin, ...event }) => ({
      ...event,
      adminName: admin?.name ?? null,
    })),
  };
}

// Per line, what could still go back to stock: per variant, what the sale took less what came
// back and what pending refunds already asked to restock, handed out lowest line id first
// against each line's refundable units (the same order restockRefund uses).
function restockableUnits(
  order: {
    readonly lines: readonly { readonly id: string; readonly variantId: string | null }[];
    readonly stockMovements: readonly {
      readonly variantId: string;
      readonly kind: string;
      readonly delta: number;
    }[];
    readonly refunds: readonly {
      readonly status: RefundStatus;
      readonly lines: readonly {
        readonly orderLineId: string;
        readonly quantity: number;
        readonly restock: boolean;
        readonly restocked: boolean;
      }[];
    }[];
  },
  math: RefundLedger,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const variants = new Set(order.lines.flatMap((line) => (line.variantId ? [line.variantId] : [])));
  for (const variantId of variants) {
    const lineIds = new Set(
      order.lines.filter((line) => line.variantId === variantId).map((line) => line.id),
    );
    const moved = order.stockMovements
      .filter((movement) => movement.variantId === variantId)
      .reduce((sum, movement) => sum - movement.delta, 0);
    const asked = order.refunds
      .filter((refund) => refund.status === "pending")
      .flatMap((refund) => refund.lines)
      .filter((line) => line.restock && !line.restocked && lineIds.has(line.orderLineId))
      .reduce((sum, line) => sum + line.quantity, 0);
    const allocation = allocateReturns(
      moved - asked,
      math.lines
        .filter((line) => lineIds.has(line.id))
        .map((line) => ({ id: line.id, quantity: refundableUnits(math, line) })),
    );
    for (const entry of allocation) result.set(entry.id, entry.returned);
  }
  return result;
}
