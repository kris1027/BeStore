export type DateFormat = {
  readonly locale: string;
  readonly timeZone: string;
};

// Timestamps are stored in UTC and shown in the store's timezone (AGENTS.md), so a date near
// midnight lands on the store's day, not the server's.
export function formatDate(date: Date, { locale, timeZone }: DateFormat): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(date);
}

// A moment to the minute, for audit trails such as an order's history.
export function formatDateTime(date: Date, { locale, timeZone }: DateFormat): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}
