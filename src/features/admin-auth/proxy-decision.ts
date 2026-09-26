import { type AdminRow, decideAdminAccess, isSessionExpired } from "./access";
import { mfaPath, signInPath, signOutPath } from "./safe-admin-path";

// Carries the requested admin path to requireAdmin(), so a page or action it bounces to the MFA
// step can come back. The proxy sets it on every request, so a client supplied value never survives.
export const adminPathHeader = "x-bestore-admin-path";

// Pages a visitor with no session may open.
const publicAdminPages = ["/admin/sign-in", "/admin/forgot-password"] as const;

// Pages that call requireAdminSession({ allowAal1: true }); the two lists must match, or the
// proxy bounces an aal1 admin away from a page that allows them.
export const aal1AdminPages = ["/admin/mfa"] as const;

export type ProxyInput = {
  readonly pathname: string;
  readonly search: string;
  // A server action POST (it carries the `Next-Action` header).
  readonly isServerAction: boolean;
  // Claims from getClaims(), null when there is no valid session.
  readonly claims: { readonly amr?: unknown } | null;
  readonly nowMs: number;
};

export type ProxyDecision =
  | { readonly kind: "continue" }
  | { readonly kind: "redirect"; readonly to: string }
  // End the session on this device, then redirect, or let the request through when `to` is null.
  | { readonly kind: "expire"; readonly to: string | null };

// The proxy is the first gate only (spec 0004): it refreshes, redirects signed out visitors
// and ends sessions past the 12 hour cap. requireAdmin() still makes the real decision.
export function decideProxy(input: ProxyInput): ProxyDecision {
  const { pathname } = input;
  // Sign out must work from any session state (spec 0005, AC-20), so the proxy never touches it.
  if (!pathname.startsWith("/admin") || pathname === signOutPath) return { kind: "continue" };

  const isPublic = publicAdminPages.some((page) => pathname === page);

  if (input.claims === null) {
    // A redirect answering an action POST breaks the client; the action's own
    // requireAdmin() redirects instead.
    if (isPublic || input.isServerAction) return { kind: "continue" };
    return { kind: "redirect", to: signInPath({ next: `${pathname}${input.search}` }) };
  }

  if (isSessionExpired(input.claims.amr, input.nowMs)) {
    if (isPublic || input.isServerAction) return { kind: "expire", to: null };
    return { kind: "expire", to: signInPath({ reason: "expired" }) };
  }

  return { kind: "continue" };
}

export type AdminGateInput = {
  readonly pathname: string;
  readonly search: string;
  readonly method: string;
  readonly isServerAction: boolean;
  readonly claims: {
    readonly sub?: unknown;
    readonly aal?: unknown;
    readonly amr?: unknown;
  };
  readonly nowMs: number;
};

export type AdminGateDecision =
  | { readonly kind: "continue" }
  | { readonly kind: "not-found" }
  | { readonly kind: "redirect"; readonly to: string };

// Cache Components streams a page's static shell before requireAdmin() runs, so a notFound()
// or redirect() there arrives as a 200 (spec 0005, AC-19). The proxy answers the page loads
// that need a real status; it only needs the admin row when this returns true.
export function needsAdminGate(input: Omit<AdminGateInput, "claims" | "nowMs">): boolean {
  const { pathname } = input;
  const inAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isOpen = pathname === signOutPath || publicAdminPages.some((page) => pathname === page);
  // Every GET, whatever its rsc or prefetch headers. An action answers for itself: a proxy
  // redirect breaks it, and its own requireAdmin() refuses.
  const isPageLoad = (input.method === "GET" || input.method === "HEAD") && !input.isServerAction;
  return inAdmin && !isOpen && isPageLoad;
}

// The same rules as requireAdmin(), so the proxy can only deny earlier, never grant: anything
// but a clear denial continues to the page, whose own guard still decides.
export function decideAdminGate(
  input: AdminGateInput & { readonly adminRow: AdminRow | null },
): AdminGateDecision {
  const { sub, aal, amr } = input.claims;
  const verdict = decideAdminAccess({
    userId: typeof sub === "string" ? sub : null,
    aal: aal === "aal2" ? "aal2" : "aal1",
    amr,
    adminRow: input.adminRow,
    nowMs: input.nowMs,
    allowAal1: aal1AdminPages.some((page) => input.pathname === page),
  });
  switch (verdict.kind) {
    case "not-found":
      return { kind: "not-found" };
    case "mfa":
      return { kind: "redirect", to: mfaPath(`${input.pathname}${input.search}`) };
    case "allow":
    case "sign-in":
      return { kind: "continue" };
  }
}
