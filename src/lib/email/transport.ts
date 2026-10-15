import "server-only";

import { Resend } from "resend";

import { env } from "@/lib/env";

import type { SendFailure } from "./classify";

// The ways an email leaves (spec 0011, AC-16): `resend` sends it, `log` sends nothing so local
// runs, tests and CI never reach a customer. `mailpit` (spec 0012, AC-23) hands it to the local
// stack's Mailpit, so e2e can read it; the env schema refuses it in production. Open and click
// tracking are domain settings in Resend and stay off there (AC-7).

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

export type TransportName = "log" | "resend" | "mailpit";

export type Transport = {
  readonly name: TransportName;
  // timeoutMs caps the one call; the auth email hook passes a shorter one than the default.
  readonly send: (
    email: OutgoingEmail,
    options?: { readonly timeoutMs?: number },
  ) => Promise<SendResult>;
};

export const EMAIL_SEND_TIMEOUT_MS = 10_000;

const logTransport: Transport = {
  name: "log",
  send: async () => ({ ok: true, resendId: null }),
};

const resendTransport: Transport = {
  name: "resend",
  send: async (email, options) => {
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
        signal: AbortSignal.timeout(options?.timeoutMs ?? EMAIL_SEND_TIMEOUT_MS),
      },
    );
    if (error) return { ok: false, failure: { name: error.name, statusCode: error.statusCode } };
    return { ok: true, resendId: data?.id ?? null };
  },
};

// `Name <address>` split for Mailpit's JSON; a bare address has no name.
function mailpitSender(from: string): { readonly Email: string; readonly Name?: string } {
  const match = /^\s*([^<>]*?)\s*<([^<>\s]+)>\s*$/.exec(from);
  if (!match?.[2]) return { Email: from.trim() };
  return match[1] ? { Email: match[2], Name: match[1] } : { Email: match[2] };
}

// Mailpit's send API has no idempotency: every call lands, which e2e relies on for resends.
// Failures map onto the Resend shape, so the classifier reads them the same way.
const mailpitTransport: Transport = {
  name: "mailpit",
  send: async (email, options) => {
    try {
      const response = await fetch(new URL("/api/v1/send", env.MAILPIT_URL), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: mailpitSender(env.EMAIL_FROM),
          To: [{ Email: email.to }],
          Subject: email.subject,
          HTML: email.html,
          Text: email.text,
        }),
        signal: AbortSignal.timeout(options?.timeoutMs ?? EMAIL_SEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { ok: false, failure: { name: "mailpit_error", statusCode: response.status } };
      }
      // Mailpit's message id is not a Resend id, so none is recorded.
      return { ok: true, resendId: null };
    } catch (error) {
      const name = error instanceof Error ? error.name : "mailpit_error";
      return { ok: false, failure: { name, statusCode: null } };
    }
  },
};

export function currentTransport(): Transport {
  switch (env.EMAIL_TRANSPORT) {
    case "resend":
      return resendTransport;
    case "mailpit":
      return mailpitTransport;
    case "log":
      return logTransport;
  }
}
