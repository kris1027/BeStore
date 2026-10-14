import { type AuthFailure, classifyAuthError } from "@/lib/auth/errors";

// A Supabase call made in after(), where nothing reaches the visitor: its failure as a fixed
// reason code for the log, or null when it went through. A throw (the network) is unavailable.
export async function settle(
  call: () => Promise<{ readonly error: { code?: string; status?: number } | null }>,
): Promise<AuthFailure | null> {
  try {
    const { error } = await call();
    return error ? classifyAuthError(error) : null;
  } catch {
    return "unavailable";
  }
}
