import { Section, Text } from "react-email";

import {
  AddressSection,
  type EmailAddressLines,
  type EmailFrame,
  type EmailItem,
  EmailLayout,
  ItemsTable,
  textStyle,
} from "./components/layout";
import { fixtureFrame } from "./fixtures";

// spec 0011, AC-5: sent once, when the order first ships. Carrier and tracking number are read at
// send time.

export type OrderShippedProps = {
  readonly frame: EmailFrame;
  readonly orderNumber: number;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly items: readonly EmailItem[];
  readonly address: EmailAddressLines | null;
};

export function orderShippedSubject(orderNumber: number): string {
  return `Order #${orderNumber} is on its way`;
}

// Only the parts that are set; null when neither is.
export function trackingLine(carrier: string | null, trackingNumber: string | null): string | null {
  const parts = [
    carrier === null ? null : `Carrier: ${carrier}`,
    trackingNumber === null ? null : `tracking number: ${trackingNumber}`,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function OrderShippedEmail(props: OrderShippedProps) {
  const subject = orderShippedSubject(props.orderNumber);
  const tracking = trackingLine(props.carrier, props.trackingNumber);
  return (
    <EmailLayout frame={props.frame} preview={subject} heading={subject}>
      <Text style={textStyle}>Good news: your order #{props.orderNumber} has shipped.</Text>
      {tracking === null ? null : <Text style={textStyle}>{tracking}</Text>}
      <Section>
        <ItemsTable caption="Items in this delivery" items={props.items} />
      </Section>
      <AddressSection address={props.address} />
    </EmailLayout>
  );
}

OrderShippedEmail.PreviewProps = {
  frame: fixtureFrame,
  orderNumber: 1042,
  carrier: "InPost",
  trackingNumber: "620123456789012345678901",
  items: [
    { name: "Linen shirt", variant: "Blue / M", quantity: 2 },
    { name: "Canvas tote", variant: null, quantity: 1 },
  ],
  address: {
    fullName: "Anna Kowalska",
    line1: "ul. Długa 12",
    line2: null,
    postalCode: "00-238",
    city: "Warszawa",
    countryName: "Poland",
  },
} satisfies OrderShippedProps;

// React Email's preview server (`pnpm email:dev`) finds a template by its default export.
export default OrderShippedEmail;
