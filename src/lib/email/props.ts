import type { EmailFrame } from "../../../emails/components/layout";
import type { OrderConfirmationProps } from "../../../emails/order-confirmation";
import type { OrderRefundedProps } from "../../../emails/order-refunded";
import type { OrderShippedProps } from "../../../emails/order-shipped";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { DeliveryAddress } from "@/lib/shipping/address";

// Pure: an order's rows to the plain props a template renders (spec 0011, Value sourcing).
// Every amount and date is formatted here, so templates never read env.

export type EmailFormat = {
  readonly locale: string;
  readonly timeZone: string;
  readonly storeName: string;
  readonly contactAddress: string;
};

export type EmailContent =
  | { readonly kind: "order_confirmation"; readonly props: OrderConfirmationProps }
  | { readonly kind: "order_shipped"; readonly props: OrderShippedProps }
  | { readonly kind: "order_refunded"; readonly props: OrderRefundedProps };

// The first whitespace separated word of customer_name; null (so "Hello,") when there is none.
export function greetingName(customerName: string | null): string | null {
  const first = customerName?.trim().split(/\s+/)[0];
  return first === undefined || first === "" ? null : first;
}

function frameOf(customerName: string | null, format: EmailFormat): EmailFrame {
  return {
    lang: format.locale,
    storeName: format.storeName,
    contactAddress: format.contactAddress,
    greetingName: greetingName(customerName),
  };
}

type OrderBasics = {
  readonly number: number;
  readonly customerName: string | null;
  readonly currency: string;
  readonly address: DeliveryAddress | null;
};

export type ConfirmationSource = OrderBasics & {
  readonly paidAt: Date;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly lines: readonly {
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
    readonly unitPriceCents: number;
    readonly lineTotalCents: number;
  }[];
};

export function confirmationProps(
  order: ConfirmationSource,
  format: EmailFormat,
): OrderConfirmationProps {
  const money = (cents: number) =>
    formatMoney(cents, { currency: order.currency, locale: format.locale });
  return {
    frame: frameOf(order.customerName, format),
    orderNumber: order.number,
    paidDate: formatDate(order.paidAt, format),
    lines: order.lines.map((line) => ({
      name: line.productName,
      variant: line.variantLabel,
      quantity: line.quantity,
      unitPrice: money(line.unitPriceCents),
      lineTotal: money(line.lineTotalCents),
    })),
    subtotal: money(order.subtotalCents),
    discount: order.discountCents > 0 ? money(order.discountCents) : null,
    delivery: order.shippingCents === 0 ? "Free" : money(order.shippingCents),
    total: money(order.totalCents),
    address: order.address,
  };
}

export type ShippedSource = OrderBasics & {
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly lines: readonly {
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
  }[];
};

export function shippedProps(order: ShippedSource, format: EmailFormat): OrderShippedProps {
  return {
    frame: frameOf(order.customerName, format),
    orderNumber: order.number,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    items: order.lines.map((line) => ({
      name: line.productName,
      variant: line.variantLabel,
      quantity: line.quantity,
    })),
    address: order.address,
  };
}

export type RefundSource = {
  readonly order: Omit<OrderBasics, "address">;
  readonly amountCents: number;
  readonly includesShipping: boolean;
  // Frozen on the email row when it was queued (AC-3).
  readonly cancelledWording: boolean;
  readonly lines: readonly {
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
  }[];
};

export function refundedProps(refund: RefundSource, format: EmailFormat): OrderRefundedProps {
  return {
    frame: frameOf(refund.order.customerName, format),
    orderNumber: refund.order.number,
    amount: formatMoney(refund.amountCents, {
      currency: refund.order.currency,
      locale: format.locale,
    }),
    items: refund.lines.map((line) => ({
      name: line.productName,
      variant: line.variantLabel,
      quantity: line.quantity,
    })),
    includesShipping: refund.includesShipping,
    cancelled: refund.cancelledWording,
  };
}
