import { Heading, Section, Text } from "react-email";

import {
  AddressSection,
  bodyCellStyle,
  DataTable,
  type EmailAddressLines,
  type EmailFrame,
  EmailLayout,
  headerCellStyle,
  itemLabel,
  subheadingStyle,
  textStyle,
} from "./components/layout";
import { fixtureFrame } from "./fixtures";

// spec 0011, AC-4: the receipt sent once an order is paid. Amounts and the date arrive formatted
// with the order's currency, STORE_LOCALE and STORE_TIMEZONE.

export type OrderConfirmationLine = {
  readonly name: string;
  readonly variant: string | null;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
};

export type OrderConfirmationProps = {
  readonly frame: EmailFrame;
  readonly orderNumber: number;
  readonly paidDate: string;
  readonly lines: readonly OrderConfirmationLine[];
  readonly subtotal: string;
  // Null when the order has no discount.
  readonly discount: string | null;
  // "Free" when the delivery fee is 0.
  readonly delivery: string;
  readonly total: string;
  readonly address: EmailAddressLines | null;
};

export function orderConfirmationSubject(orderNumber: number): string {
  return `Order #${orderNumber} confirmed`;
}

export function OrderConfirmationEmail(props: OrderConfirmationProps) {
  const subject = orderConfirmationSubject(props.orderNumber);
  return (
    <EmailLayout frame={props.frame} preview={subject} heading={subject}>
      <Text style={textStyle}>
        Thank you for your order. We received your payment on {props.paidDate}.
      </Text>
      <Section>
        <Heading as="h2" style={subheadingStyle}>
          Order #{props.orderNumber}
        </Heading>
        <DataTable caption="Items in your order">
          <thead>
            <tr>
              <th scope="col" align="left" style={headerCellStyle}>
                Item
              </th>
              <th scope="col" align="right" style={headerCellStyle}>
                Quantity
              </th>
              <th scope="col" align="right" style={headerCellStyle}>
                Price
              </th>
              <th scope="col" align="right" style={headerCellStyle}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((line, index) => (
              <tr key={index}>
                <td style={bodyCellStyle}>{itemLabel(line)}</td>
                <td align="right" style={bodyCellStyle}>
                  {line.quantity}
                </td>
                <td align="right" style={bodyCellStyle}>
                  {line.unitPrice}
                </td>
                <td align="right" style={bodyCellStyle}>
                  {line.lineTotal}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <DataTable caption="Order summary" spaced>
          <tbody>
            <SummaryRow label="Subtotal" value={props.subtotal} />
            {props.discount === null ? null : (
              <SummaryRow label="Discount" value={props.discount} />
            )}
            <SummaryRow label="Delivery" value={props.delivery} />
            <SummaryRow label="Total" value={props.total} strong />
          </tbody>
        </DataTable>
      </Section>
      <AddressSection address={props.address} />
      <Text style={{ ...textStyle, marginTop: "24px" }}>
        We&apos;ll email you when your order ships.
      </Text>
    </EmailLayout>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}) {
  const weight = strong ? 700 : 400;
  return (
    <tr>
      <th scope="row" align="left" style={{ ...bodyCellStyle, fontWeight: weight }}>
        {label}
      </th>
      <td align="right" style={{ ...bodyCellStyle, fontWeight: weight }}>
        {value}
      </td>
    </tr>
  );
}

OrderConfirmationEmail.PreviewProps = {
  frame: fixtureFrame,
  orderNumber: 1042,
  paidDate: "Oct 13, 2026",
  lines: [
    {
      name: "Linen shirt",
      variant: "Blue / M",
      quantity: 2,
      unitPrice: "€39.00",
      lineTotal: "€78.00",
    },
    { name: "Canvas tote", variant: null, quantity: 1, unitPrice: "€19.00", lineTotal: "€19.00" },
  ],
  subtotal: "€97.00",
  discount: null,
  delivery: "€9.99",
  total: "€106.99",
  address: {
    fullName: "Anna Kowalska",
    line1: "ul. Długa 12",
    line2: "m. 4",
    postalCode: "00-238",
    city: "Warszawa",
    countryName: "Poland",
  },
} satisfies OrderConfirmationProps;

// React Email's preview server (`pnpm email:dev`) finds a template by its default export.
export default OrderConfirmationEmail;
