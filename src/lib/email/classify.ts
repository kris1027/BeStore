// Pure: what a Resend error means for an email row (spec 0011, AC-9). The Resend SDK does not
// throw; it answers `{ error: { name, statusCode } }`, with statusCode null for a network error
// or a timeout (the SDK turns an aborted fetch into the same answer).

export type SendFailure = { readonly name: string; readonly statusCode: number | null };

export type FailureVerdict =
  // Resend refused it for good (an invalid recipient, any other 400 or 422 or 4xx): failed.
  | { readonly kind: "final"; readonly errorCode: string }
  // A bad key or an unverified domain: stays pending until the config is fixed.
  | { readonly kind: "config"; readonly errorCode: string }
  // 429: stays pending, and the sweep stops so it does not spend the rest of the quota.
  | { readonly kind: "rate_limited"; readonly errorCode: string }
  // 5xx, a network error, a timeout, or the same key still in flight: stays pending.
  | { readonly kind: "retry"; readonly errorCode: string }
  // Resend already accepted a send with this key (a retry carried newer content): sent.
  | { readonly kind: "already_sent" };

export function classifySendFailure(failure: SendFailure): FailureVerdict {
  const errorCode = failure.name;
  if (failure.name === "invalid_idempotent_request") return { kind: "already_sent" };
  if (failure.name === "concurrent_idempotent_requests") return { kind: "retry", errorCode };
  const status = failure.statusCode;
  if (status === null || status >= 500) return { kind: "retry", errorCode };
  if (status === 401 || status === 403) return { kind: "config", errorCode };
  if (status === 429) return { kind: "rate_limited", errorCode };
  if (status >= 400) return { kind: "final", errorCode };
  // A non error status with an error body is not something Resend sends; try again later.
  return { kind: "retry", errorCode };
}

// Whether the sweep should stop trying more rows after this answer (AC-11).
export function stopsSweep(verdict: FailureVerdict): boolean {
  return verdict.kind === "config" || verdict.kind === "rate_limited";
}
