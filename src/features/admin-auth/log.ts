import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";

// The auth events of spec 0004 (AC-13), each logged once where it happens.
export type AuthEvent =
  | "auth.sign_in.succeeded"
  | "auth.sign_in.failed"
  | "auth.mfa.enrolled"
  | "auth.mfa.succeeded"
  | "auth.mfa.failed"
  | "auth.mfa.locked"
  | "auth.sign_out"
  | "auth.session.expired"
  | "auth.access.denied"
  | "auth.proxy.lookup_failed"
  | "auth.reset.requested"
  | "auth.password.changed";

export type AuthEventFields = {
  // The admin or user id when known.
  readonly adminId?: string | null;
  // Only when no id is known: hashed, never the address itself.
  readonly email?: string | null;
  readonly ip: string | null;
  readonly reason?: string;
  readonly sent?: boolean;
};

// Unsalted on purpose: it only correlates repeated attempts, and emails are guessable anyway.
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// Vercel sets x-forwarded-for; its first entry is the client.
export function requestIp(headers: Pick<Headers, "get">): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first : null;
}

export function authEventRecord(event: AuthEvent, fields: AuthEventFields) {
  const { adminId, email, ip, reason, sent } = fields;
  return {
    event,
    ...(adminId ? { adminId } : email ? { emailHash: hashEmail(email) } : {}),
    ip,
    ...(reason === undefined ? {} : { reason }),
    ...(sent === undefined ? {} : { sent }),
  };
}

export function logAuthEvent(event: AuthEvent, fields: AuthEventFields) {
  const record = authEventRecord(event, fields);
  const failed = event.endsWith("failed") || event.endsWith(".locked") || event.endsWith(".denied");
  if (failed) logger.warn(record, event);
  else logger.info(record, event);
}
