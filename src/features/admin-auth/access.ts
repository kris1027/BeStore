// Pure access rules for /admin (spec 0004). No I/O: requireAdmin() and the proxy gather the
// inputs and act on the verdict, so every rule lives here and is unit tested.

// The app enforced session cap, from the first factor's sign in (AC-7).
export const ADMIN_SESSION_MAX_AGE_SECONDS = 43_200;

export type AssuranceLevel = "aal1" | "aal2";

export type AdminRow = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly disabledAt: Date | null;
};

export type Admin = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
};

export type AccessInput = {
  // Confirmed by the Auth server (getUser), null when there is no valid session.
  readonly userId: string | null;
  readonly aal: AssuranceLevel | null;
  // The `amr` list from the session token.
  readonly amr: unknown;
  // The live admin_users row for userId, if any.
  readonly adminRow: AdminRow | null;
  readonly nowMs: number;
  // The MFA step and sign out run below aal2.
  readonly allowAal1?: boolean;
};

export type AccessVerdict =
  | { readonly kind: "allow"; readonly admin: Admin }
  | { readonly kind: "sign-in"; readonly reason?: "expired" }
  | { readonly kind: "mfa" }
  | { readonly kind: "not-found" };

// The session start is the earliest `amr` timestamp: the first factor. Token refreshes carry
// `amr` over and a later TOTP verify only adds or bumps the `totp` entry, so neither can move
// it forward. Returns null when no timestamp is present.
export function sessionStartedAtSeconds(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  const timestamps = amr.flatMap((entry: unknown) =>
    typeof entry === "object" &&
    entry !== null &&
    "timestamp" in entry &&
    typeof entry.timestamp === "number" &&
    Number.isFinite(entry.timestamp)
      ? [entry.timestamp]
      : [],
  );
  return timestamps.length > 0 ? Math.min(...timestamps) : null;
}

// A session with no readable start fails closed: it is treated as expired.
export function isSessionExpired(amr: unknown, nowMs: number): boolean {
  const startedAt = sessionStartedAtSeconds(amr);
  if (startedAt === null) return true;
  return nowMs / 1000 - startedAt > ADMIN_SESSION_MAX_AGE_SECONDS;
}

// A session opened by a password reset or email link can verify a factor, never enroll one.
export function isResetSession(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry: unknown) => {
    const method =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null && "method" in entry
          ? entry.method
          : null;
    return method === "recovery" || method === "otp";
  });
}

// Checked in the spec's order: session, age, admin row, assurance level.
export function decideAdminAccess(input: AccessInput): AccessVerdict {
  if (input.userId === null) return { kind: "sign-in" };
  if (isSessionExpired(input.amr, input.nowMs)) return { kind: "sign-in", reason: "expired" };

  const row = input.adminRow;
  if (row === null || row.id !== input.userId || row.disabledAt !== null) {
    return { kind: "not-found" };
  }
  const admin = { id: row.id, email: row.email, name: row.name };

  if (input.aal !== "aal2" && !input.allowAal1) return { kind: "mfa" };
  return { kind: "allow", admin };
}
