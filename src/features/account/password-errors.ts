import { classifyAuthError } from "@/lib/auth/errors";

import { accountMessages } from "./messages";

// Pure: what Supabase's answer to a new password means (spec 0012, AC-3). `pwned` is the leaked
// password check; any other weak password answer means the schema and the policy drifted apart.

export type PasswordUpdateError =
  "leaked_password" | "weak_password" | "same_password" | "rate_limited" | "unavailable";

type PasswordErrorLike = {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly reasons?: readonly string[] | undefined;
};

export function passwordUpdateError(error: PasswordErrorLike): PasswordUpdateError {
  if (error.code === "same_password") return "same_password";
  if (error.code === "weak_password") {
    return error.reasons?.includes("pwned") ? "leaked_password" : "weak_password";
  }
  return classifyAuthError(error) === "rate_limited" ? "rate_limited" : "unavailable";
}

export const passwordUpdateMessages: Record<PasswordUpdateError, string> = {
  leaked_password: accountMessages.leakedPassword,
  weak_password: accountMessages.weakPassword,
  same_password: accountMessages.samePassword,
  rate_limited: accountMessages.rateLimited,
  unavailable: accountMessages.unavailable,
};
