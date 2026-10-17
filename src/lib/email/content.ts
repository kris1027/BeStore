import "server-only";

import type { EmailKind } from "@/generated/prisma/client";
import { brand } from "@/lib/brand/brand";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deliveryAddressColumns, withDeliveryAddress } from "@/lib/shipping/address";

import {
  confirmationProps,
  type EmailContent,
  type EmailFormat,
  refundedProps,
  shippedProps,
} from "./props";

// spec 0011: emails are rendered from the database at send time, never stored, so no second copy
// of the address or items sits in email_sends (the purge in spec 0008 stays the only cleanup).

export type ContentRow = {
  readonly orderId: string;
  readonly kind: EmailKind;
  readonly refundId: string | null;
  readonly cancelledWording: boolean;
};

function emailFormat(): EmailFormat {
  return {
    locale: env.STORE_LOCALE,
    timeZone: env.STORE_TIMEZONE,
    storeName: brand.name,
    contactAddress: env.EMAIL_FROM_ADDRESS,
  };
}

const lineOrder = [{ createdAt: "asc" as const }, { id: "asc" as const }];

// Throws when the rows it needs are gone or inconsistent (a paid order with no paid_at): a bug,
// and the row stays pending for the sweep.
export async function loadEmailContent(row: ContentRow): Promise<EmailContent> {
  const format = emailFormat();
  switch (row.kind) {
    case "order_confirmation": {
      const order = await db.order.findUniqueOrThrow({
        where: { id: row.orderId },
        select: {
          number: true,
          customerName: true,
          currency: true,
          paidAt: true,
          subtotalCents: true,
          discountCents: true,
          discountCode: true,
          shippingCents: true,
          totalCents: true,
          ...deliveryAddressColumns,
          lines: {
            orderBy: lineOrder,
            select: {
              productName: true,
              variantLabel: true,
              quantity: true,
              unitPriceCents: true,
              lineTotalCents: true,
            },
          },
        },
      });
      if (order.paidAt === null) throw new Error(`Order ${order.number} has no paid_at`);
      return {
        kind: row.kind,
        props: confirmationProps(
          { ...withDeliveryAddress(order, format.locale), paidAt: order.paidAt },
          format,
        ),
      };
    }
    case "order_shipped": {
      const order = await db.order.findUniqueOrThrow({
        where: { id: row.orderId },
        select: {
          number: true,
          customerName: true,
          currency: true,
          carrier: true,
          trackingNumber: true,
          ...deliveryAddressColumns,
          lines: {
            orderBy: lineOrder,
            select: { productName: true, variantLabel: true, quantity: true },
          },
        },
      });
      return {
        kind: row.kind,
        props: shippedProps(withDeliveryAddress(order, format.locale), format),
      };
    }
    case "order_refunded": {
      if (row.refundId === null) throw new Error("A refund email without a refund");
      const refund = await db.refund.findUniqueOrThrow({
        where: { id: row.refundId },
        select: {
          amountCents: true,
          includesShipping: true,
          order: { select: { number: true, customerName: true, currency: true } },
          lines: {
            orderBy: { orderLine: { createdAt: "asc" } },
            select: {
              quantity: true,
              orderLine: { select: { productName: true, variantLabel: true } },
            },
          },
        },
      });
      return {
        kind: row.kind,
        props: refundedProps(
          {
            order: refund.order,
            amountCents: refund.amountCents,
            includesShipping: refund.includesShipping,
            cancelledWording: row.cancelledWording,
            lines: refund.lines.map((line) => ({ ...line.orderLine, quantity: line.quantity })),
          },
          format,
        ),
      };
    }
  }
}
