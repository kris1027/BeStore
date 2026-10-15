import { createHash } from "node:crypto";

import { z } from "zod";

// Pure: the Send Email Hook's payload, which email it sends, and where the link points
// (spec 0012, AC-8). The signature is checked before anything here runs.

export const hookPayloadSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email() }),
  email_data: z.object({
    token_hash: z.string().min(1),
    email_action_type: z.string().min(1),
  }),
});

export type HookPayload = z.output<typeof hookPayloadSchema>;

// The only Supabase email types this store uses. Every other (magiclink, invite, email_change,
// reauthentication, notifications) is refused.
export type AuthActionType = "signup" | "recovery";

export function usedActionType(type: string): AuthActionType | null {
  return type === "signup" || type === "recovery" ? type : null;
}

export type AuthEmailKind = "confirm_signup" | "customer_reset" | "admin_reset";

// Admin first: whether the user runs the store cannot be steered by the caller, unlike
// redirect_to, which anyone with the anon key can set. So an inbox alone never resets a password
// that guards /admin.
export function authEmailKind(type: AuthActionType, runsTheStore: boolean): AuthEmailKind {
  if (type === "signup") return "confirm_signup";
  return runsTheStore ? "admin_reset" : "customer_reset";
}

const linkPaths: Record<AuthEmailKind, string> = {
  confirm_signup: "/account/confirm",
  customer_reset: "/account/confirm",
  admin_reset: "/auth/confirm",
};

const linkTypes: Record<AuthEmailKind, AuthActionType> = {
  confirm_signup: "signup",
  customer_reset: "recovery",
  admin_reset: "recovery",
};

// The token hash link pattern: the page shows Continue first, and only that POST spends it.
export function authEmailLink(siteUrl: string, kind: AuthEmailKind, tokenHash: string): string {
  const url = new URL(linkPaths[kind], siteUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", linkTypes[kind]);
  return url.toString();
}

// One send per link: Supabase retrying a hook call never mails the same link twice. Hashed, so
// the key never carries the token hash itself.
export function authIdempotencyKey(type: AuthActionType, tokenHash: string): string {
  return `auth:${type}:${createHash("sha256").update(tokenHash).digest("hex")}`;
}

// The secret as Supabase shows it (`v1,whsec_<base64>`), as the standardwebhooks package takes it.
export function hookSecretKey(secret: string): string {
  return secret.replace(/^v1,whsec_/, "");
}

// The error body Supabase reads from a failed hook.
export function hookErrorBody(httpCode: number, message: string) {
  return { error: { http_code: httpCode, message } };
}
