import { isSessionExpired } from "./access";
import { signInPath } from "./safe-admin-path";

// Carries the requested admin path to requireAdmin(), so a page or action it bounces to the MFA
// step can come back. The proxy sets it on every request, so a client supplied value never survives.
export const adminPathHeader = "x-bestore-admin-path";

// Pages a visitor with no session may open.
const publicAdminPages = ["/admin/sign-in", "/admin/forgot-password"] as const;

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
  if (!pathname.startsWith("/admin")) return { kind: "continue" };

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
