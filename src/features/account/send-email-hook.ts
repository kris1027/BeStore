import "server-only";

import { Webhook } from "standardwebhooks";

import { brand } from "@/lib/brand/brand";
import { runsTheStore } from "@/lib/customer/store-admin";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import {
  type AuthEmailKind,
  authEmailKind,
  authEmailLink,
  authIdempotencyKey,
  hookErrorBody,
  hookPayloadSchema,
  hookSecretKey,
  skipsAuthEmail,
  usedActionType,
} from "@/lib/email/auth-hook";
import { classifySendFailure } from "@/lib/email/classify";
import { renderAuthEmail } from "@/lib/email/render-auth";
import { currentTransport } from "@/lib/email/transport";

// Supabase waits 5 seconds for the hook, so the one send gets 4.
export const AUTH_EMAIL_TIMEOUT_MS = 4_000;

function json(status: number, body: object): Response {
  return Response.json(body, { status });
}

// spec 0012, AC-24: kind, user id and error name only, never the address, link or key.
function logSent(kind: AuthEmailKind, userId: string) {
  logger.info({ event: "auth_email.sent", kind, userId }, "auth_email.sent");
}

function logFailed(kind: AuthEmailKind | null, userId: string, errorName: string) {
  logger.error(
    { event: "auth_email.failed", kind, userId, errorName, errorLevel: "error" },
    "auth_email.failed",
  );
}

// POST /api/auth/send-email, the Send Email Hook (spec 0012, AC-8). Supabase calls it for every
// auth email; nothing leaves without a valid Standard Webhooks signature over the raw body.
export async function handleSendEmailHook(request: Request): Promise<Response> {
  const body = await request.text();
  let verified: unknown;
  try {
    verified = new Webhook(hookSecretKey(env.SEND_EMAIL_HOOK_SECRET)).verify(
      body,
      Object.fromEntries(request.headers),
    );
  } catch {
    logger.warn({ event: "auth_email.bad_signature" }, "auth_email.bad_signature");
    return json(401, hookErrorBody(401, "invalid signature"));
  }

  const parsed = hookPayloadSchema.safeParse(verified);
  if (!parsed.success) {
    // A signed payload that breaks Supabase's contract, not a type we refuse: the field paths
    // only, never their values.
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    logger.warn({ event: "auth_email.bad_payload", fields }, "auth_email.bad_payload");
    return json(400, hookErrorBody(400, "invalid payload"));
  }
  const type = usedActionType(parsed.data.email_data.email_action_type);
  if (type === null) {
    logger.warn({ event: "auth_email.unexpected_type" }, "auth_email.unexpected_type");
    return json(400, hookErrorBody(400, "unsupported email type"));
  }
  const { user, email_data: emailData } = parsed.data;

  let kind: AuthEmailKind | null = null;
  try {
    if (skipsAuthEmail(type, type === "recovery" ? await runsTheStore(user.id) : false)) {
      // A 200 makes Supabase report success, so the customer forgot page answers the same way,
      // at the same speed, and never reveals that the email runs the store.
      logger.info(
        { event: "auth_email.skipped", userId: user.id, reason: "runs_the_store" },
        "auth_email.skipped",
      );
      return json(200, {});
    }
    kind = authEmailKind(type);
    const link = authEmailLink(env.NEXT_PUBLIC_SITE_URL, kind, emailData.token_hash);
    const rendered = await renderAuthEmail(
      kind,
      {
        lang: env.STORE_LOCALE,
        storeName: brand.name,
        contactAddress: env.EMAIL_FROM_ADDRESS,
        greetingName: null,
      },
      link,
    );
    const result = await currentTransport().send(
      {
        to: user.email,
        ...rendered,
        idempotencyKey: authIdempotencyKey(type, emailData.token_hash),
      },
      { timeoutMs: AUTH_EMAIL_TIMEOUT_MS },
    );
    // Resend already took this key: an earlier try of the same hook call got through.
    if (!result.ok && classifySendFailure(result.failure).kind !== "already_sent") {
      logFailed(kind, user.id, result.failure.name);
      return json(500, hookErrorBody(500, "send failed"));
    }
  } catch (error) {
    logFailed(kind, user.id, error instanceof Error ? error.name : typeof error);
    return json(500, hookErrorBody(500, "send failed"));
  }

  logSent(kind, user.id);
  return json(200, {});
}
