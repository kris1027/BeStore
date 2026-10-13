import "server-only";

import { Resend } from "resend";

import { env } from "@/lib/env";

import type { SendFailure } from "./classify";

// The two ways an email leaves (spec 0011, AC-16): `resend` sends it, `log` sends nothing so
// local runs, tests and CI never reach a customer. Open and click tracking are domain settings in
// Resend and stay off there (AC-7).

export type OutgoingEmail = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  // The row's dedupe_key: two sends with one key within 24 hours deliver once.
  readonly idempotencyKey: string;
};

export type SendResult =
  | { readonly ok: true; readonly resendId: string | null }
  | { readonly ok: false; readonly failure: SendFailure };

export type Transport = {
  readonly name: "log" | "resend";
  readonly send: (email: OutgoingEmail) => Promise<SendResult>;
};

export const EMAIL_SEND_TIMEOUT_MS = 10_000;

const logTransport: Transport = {
  name: "log",
  send: async () => ({ ok: true, resendId: null }),
};

const resendTransport: Transport = {
  name: "resend",
  send: async (email) => {
    // Built per send (the constructor only sets headers), so importing this file never needs
    // the key. The SDK answers { error } instead of throwing; an abort comes back as statusCode
    // null.
    const { data, error } = await new Resend(env.RESEND_API_KEY).emails.send(
      {
        from: env.EMAIL_FROM,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      {
        idempotencyKey: email.idempotencyKey,
        signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
      },
    );
    if (error) return { ok: false, failure: { name: error.name, statusCode: error.statusCode } };
    return { ok: true, resendId: data?.id ?? null };
  },
};

export function currentTransport(): Transport {
  return env.EMAIL_TRANSPORT === "resend" ? resendTransport : logTransport;
}
