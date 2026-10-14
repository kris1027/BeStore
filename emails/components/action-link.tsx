import { Button, Link, Text } from "react-email";

import { colors, mutedStyle } from "./layout";

// The one action of an auth email: a button, then the same address as text for mail apps that
// drop buttons. Dark on white and white on dark both pass WCAG AA.
export function ActionLink({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <>
      <Button
        href={href}
        style={{
          backgroundColor: colors.text,
          color: "#ffffff",
          borderRadius: "6px",
          fontSize: "16px",
          fontWeight: 600,
          lineHeight: "24px",
          padding: "12px 20px",
          textDecoration: "none",
          margin: "8px 0 24px",
        }}
      >
        {label}
      </Button>
      <Text style={mutedStyle}>
        Or copy this link into your browser:{" "}
        <Link href={href} style={{ color: colors.text, wordBreak: "break-all" }}>
          {href}
        </Link>
      </Text>
    </>
  );
}
