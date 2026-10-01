import { type DateFormat, formatDate } from "@/lib/dates";

import { emailDisplay } from "../email-display";

// Where the value sits: a list cell is one truncated line with no date; the detail page says
// when the purge ran and lets a long email wrap.
export type PersonalDataPlacement =
  | { readonly placement: "list" }
  | { readonly placement: "detail"; readonly dateFormat: DateFormat };

function PersonalDataRemoved(props: PersonalDataPlacement & { readonly purgedAt: Date }) {
  return (
    <span className="text-muted-foreground">
      {props.placement === "detail"
        ? `Personal data removed on ${formatDate(props.purgedAt, props.dateFormat)}`
        : "Personal data removed"}
    </span>
  );
}

// spec 0008, AC-8: the purge stamp is checked before the field's own fallbacks ("Not recorded",
// "No address recorded"), so a purged order never reads as one that simply had no address.
export function PersonalDataField({
  purgedAt,
  children,
  ...placement
}: PersonalDataPlacement & {
  readonly purgedAt: Date | null;
  readonly children: React.ReactNode;
}) {
  if (purgedAt !== null) return <PersonalDataRemoved {...placement} purgedAt={purgedAt} />;
  return children;
}

// spec 0008, AC-8 and AC-9.
export function OrderEmail({
  order,
  ...placement
}: PersonalDataPlacement & {
  readonly order: { readonly email: string | null; readonly piiPurgedAt: Date | null };
}) {
  const display = emailDisplay(order);
  switch (display.kind) {
    case "email":
      return placement.placement === "detail" ? (
        <span className="break-all">{display.email}</span>
      ) : (
        display.email
      );
    case "purged":
      return <PersonalDataRemoved {...placement} purgedAt={display.purgedAt} />;
    // The detail query throws before this; kept so a null email can never render as empty.
    case "missing":
      return <span className="text-destructive">Email missing</span>;
  }
}
