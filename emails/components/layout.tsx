import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "react-email";

// The frame every customer email shares (spec 0011, AC-7 and AC-18): one column, the store name
// as a text wordmark (no images, no tracking pixel), real headings, and a footer that sends
// questions to the sender mailbox. Every string arrives formatted; templates never read env.

export type EmailFrame = {
  // STORE_LOCALE, for <html lang>.
  readonly lang: string;
  readonly storeName: string;
  // The address part of EMAIL_FROM.
  readonly contactAddress: string;
  // First word of customer_name, or null for "Hello,".
  readonly greetingName: string | null;
};

export type EmailAddressLines = {
  readonly fullName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly countryName: string;
};

export type EmailItem = {
  readonly name: string;
  readonly variant: string | null;
  readonly quantity: number;
};

// Colours chosen for at least 4.5:1 on white (WCAG AA).
export const colors = {
  text: "#1a1a1a",
  muted: "#525252",
  border: "#d4d4d4",
  page: "#f5f5f5",
} as const;

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const textStyle = {
  color: colors.text,
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px",
};
export const mutedStyle = {
  ...textStyle,
  color: colors.muted,
  fontSize: "14px",
  lineHeight: "20px",
};
export const subheadingStyle = {
  color: colors.text,
  fontSize: "18px",
  lineHeight: "24px",
  fontWeight: 600,
  margin: "24px 0 8px",
};

export function greeting(name: string | null): string {
  return name === null ? "Hello," : `Hi ${name},`;
}

export function itemLabel(item: EmailItem): string {
  return item.variant === null ? item.name : `${item.name} (${item.variant})`;
}

export function EmailLayout({
  frame,
  preview,
  heading,
  children,
}: {
  readonly frame: EmailFrame;
  readonly preview: string;
  readonly heading: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Html lang={frame.lang} dir="ltr">
      <Head />
      <Body
        style={{ backgroundColor: colors.page, fontFamily: font, margin: 0, padding: "24px 0" }}
      >
        <Preview>{preview}</Preview>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px 24px", maxWidth: "600px" }}>
          <Text
            style={{
              color: colors.text,
              fontSize: "20px",
              lineHeight: "28px",
              fontWeight: 700,
              margin: "0 0 24px",
            }}
          >
            {frame.storeName}
          </Text>
          <Heading
            as="h1"
            style={{ color: colors.text, fontSize: "24px", lineHeight: "32px", margin: "0 0 16px" }}
          >
            {heading}
          </Heading>
          <Text style={textStyle}>{greeting(frame.greetingName)}</Text>
          {children}
          <Hr
            style={{
              borderTop: `1px solid ${colors.border}`,
              borderStyle: "solid",
              margin: "32px 0 16px",
            }}
          />
          <Text style={mutedStyle}>
            Questions? Reply to this email or write to {frame.contactAddress}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function AddressSection({ address }: { readonly address: EmailAddressLines | null }) {
  if (address === null) return null;
  return (
    <Section>
      <Heading as="h2" style={subheadingStyle}>
        Delivery address
      </Heading>
      <Text style={textStyle}>
        {address.fullName}
        <br />
        {address.line1}
        {address.line2 === null ? null : (
          <>
            <br />
            {address.line2}
          </>
        )}
        <br />
        {address.postalCode} {address.city}
        <br />
        {address.countryName}
      </Text>
    </Section>
  );
}

const cellStyle = {
  color: colors.text,
  fontSize: "14px",
  lineHeight: "20px",
  padding: "8px 0",
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: "top",
} as const;

export const headerCellStyle = { ...cellStyle, color: colors.muted, fontWeight: 600 } as const;
export const bodyCellStyle = cellStyle;

// Items without prices (shipped, refund): a real data table with header cells (AC-18).
export function ItemsTable({
  caption,
  items,
}: {
  readonly caption: string;
  readonly items: readonly EmailItem[];
}) {
  return (
    <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
      <caption style={{ ...mutedStyle, textAlign: "left", margin: "0 0 4px" }}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col" align="left" style={headerCellStyle}>
            Item
          </th>
          <th scope="col" align="right" style={headerCellStyle}>
            Quantity
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={index}>
            <td style={bodyCellStyle}>{itemLabel(item)}</td>
            <td align="right" style={bodyCellStyle}>
              {item.quantity}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
