// Maps a Supabase Auth error to the fixed message keys of spec 0004. Pure, so the mapping is
// unit tested without a network.

export type AuthErrorLike = {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
};

export type AuthFailure = "rate_limited" | "unavailable" | "rejected";

const rateLimitCodes = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

export function classifyAuthError(error: AuthErrorLike): AuthFailure {
  if ((error.code && rateLimitCodes.has(error.code)) || error.status === 429) return "rate_limited";
  // No status means the request never got an answer (network error, timeout).
  if (error.status === undefined || error.status === 0 || error.status >= 500) {
    return "unavailable";
  }
  return "rejected";
}
