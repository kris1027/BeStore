import { CircleAlertIcon, InfoIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

type FormNoticeProps = {
  readonly message: string | null;
  // `error` is announced at once (role alert); `info` politely (role status).
  readonly tone?: "error" | "info";
  readonly id?: string;
};

// A form level message. The live region stays mounted, so a message set after a submit is
// announced by screen readers.
export function FormNotice({ message, tone = "error", id }: FormNoticeProps) {
  const role = tone === "error" ? "alert" : "status";
  if (!message) return <div role={role} id={id} className="sr-only" />;
  const Icon = tone === "error" ? CircleAlertIcon : InfoIcon;
  return (
    <Alert role={role} id={id} variant={tone === "error" ? "destructive" : "default"}>
      <Icon aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
