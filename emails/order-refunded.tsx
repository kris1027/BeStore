import { Section, Text } from "react-email";

import {
  type EmailFrame,
  type EmailItem,
  EmailLayout,
  ItemsTable,
  textStyle,
} from "./components/layout";
import { fixtureFrame } from "./fixtures";

// spec 0011, AC-6: one email per refund that succeeded. `cancelled` is the wording frozen on the
// row when the refund was queued (AC-3), never decided here. The admin's reason is never shown.

export type OrderRefundedProps = {
  readonly frame: EmailFrame;
  readonly orderNumber: number;
  readonly amount: string;
  // Empty for a refund with no lines (a delivery only or a dashboard refund).
  readonly items: readonly EmailItem[];
  readonly includesShipping: boolean;
  readonly cancelled: boolean;
};

export function orderRefundedSubject(orderNumber: number, cancelled: boolean): string {
  return cancelled
    ? `Order #${orderNumber} cancelled and refunded`
    : `Refund for order #${orderNumber}`;
}

export function OrderRefundedEmail(props: OrderRefundedProps) {
  const subject = orderRefundedSubject(props.orderNumber, props.cancelled);
  return (
    <EmailLayout frame={props.frame} preview={subject} heading={subject}>
      {props.cancelled ? (
        <Text style={textStyle}>Your order was cancelled and refunded in full.</Text>
      ) : null}
      <Text style={textStyle}>
        We refunded {props.amount} for order #{props.orderNumber}.
      </Text>
      {props.items.length > 0 ? (
        <Section>
          <ItemsTable caption="Refunded items" items={props.items} />
        </Section>
      ) : null}
      {props.includesShipping ? <Text style={textStyle}>Delivery fee refunded</Text> : null}
      <Text style={textStyle}>
        Your bank usually shows the refund within 5 to 10 business days.
      </Text>
    </EmailLayout>
  );
}

OrderRefundedEmail.PreviewProps = {
  frame: fixtureFrame,
  orderNumber: 1042,
  amount: "€39.00",
  items: [{ name: "Linen shirt", variant: "Blue / M", quantity: 1 }],
  includesShipping: false,
  cancelled: false,
} satisfies OrderRefundedProps;

// React Email's preview server (`pnpm email:dev`) finds a template by its default export.
export default OrderRefundedEmail;
