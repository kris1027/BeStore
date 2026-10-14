import { Badge } from "@/components/ui/badge";
import type { DateFormat } from "@/lib/dates";

import {
  type AdminEmailSend,
  canSendAgain,
  emailKindLabel,
  emailStatusText,
} from "../email-status";
import { SendAgainDialog } from "./send-again-dialog";

// spec 0011, AC-13: which emails went out for this order, newest first, so an admin can answer
// "I never got an email" without leaving the panel.
export function EmailsSection({
  orderNumber,
  emails,
  currency,
  dateFormat,
}: {
  readonly orderNumber: number;
  readonly emails: readonly AdminEmailSend[];
  readonly currency: string;
  readonly dateFormat: DateFormat;
}) {
  if (emails.length === 0) {
    return <p className="text-sm text-muted-foreground">No emails sent for this order.</p>;
  }
  const money = { currency, locale: dateFormat.locale };
  return (
    <ul className="flex flex-col gap-4" aria-label="Emails, newest first">
      {emails.map((email) => {
        const label = emailKindLabel(email, money);
        return (
          <li key={email.id} className="flex flex-col gap-2 border-l-2 pl-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{label}</span>
              <Badge
                variant={
                  email.status === "failed"
                    ? "destructive"
                    : email.status === "pending"
                      ? "outline"
                      : "secondary"
                }
              >
                {emailStatusText(email, dateFormat)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {email.attempts === 1 ? "1 attempt" : `${email.attempts} attempts`}
            </p>
            {canSendAgain(email) ? (
              <SendAgainDialog
                orderNumber={orderNumber}
                emailSendId={email.id}
                label={label}
                mayHaveBeenSent={email.errorCode === "gave_up"}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
