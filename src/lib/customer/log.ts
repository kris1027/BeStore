import { logger } from "@/lib/logger";

// spec 0012, AC-24: the customer id, order ids and numbers, counts and reason codes only. Never an
// email, name, phone, address, password, token, token hash or idempotency key.

export type AccountEvent =
  | "account.sign_up"
  | "account.sign_in"
  | "account.sign_in_failed"
  | "account.confirmed"
  | "account.orders_linked"
  | "account.cart_merged"
  | "account.address_saved"
  | "account.password_changed"
  | "account.reset_requested"
  | "account.password_reset"
  | "account.deleted"
  | "account.delete_refused_admin"
  | "account.email_conflict"
  | "account.delete_incomplete";

export type AccountEventFields = {
  readonly customerId?: string | null;
  readonly count?: number;
  // A fixed reason code, never a Supabase message.
  readonly reason?: string;
  readonly lines?: number;
  readonly sent?: boolean;
};

const errorEvents: ReadonlySet<AccountEvent> = new Set([
  "account.email_conflict",
  "account.delete_incomplete",
]);
const warnEvents: ReadonlySet<AccountEvent> = new Set([
  "account.sign_in_failed",
  "account.delete_refused_admin",
]);

export function accountEventRecord(event: AccountEvent, fields: AccountEventFields) {
  const { customerId, count, reason, lines, sent } = fields;
  return {
    event,
    ...(customerId ? { customerId } : {}),
    ...(count === undefined ? {} : { count }),
    ...(reason === undefined ? {} : { reason }),
    ...(lines === undefined ? {} : { lines }),
    ...(sent === undefined ? {} : { sent }),
  };
}

export function logAccountEvent(event: AccountEvent, fields: AccountEventFields = {}) {
  const record = accountEventRecord(event, fields);
  if (errorEvents.has(event)) logger.error(record, event);
  else if (warnEvents.has(event)) logger.warn(record, event);
  else logger.info(record, event);
}
