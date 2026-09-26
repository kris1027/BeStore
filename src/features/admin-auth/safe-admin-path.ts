export const adminHome = "/admin";

// A POST route handler (spec 0005, AC-20).
export const signOutPath = "/admin/sign-out";

// Pages a `next` must never point back at; the reset page is allowed, since the reset link
// sends the admin through the MFA step on the way there.
const authPages = ["/admin/sign-in", "/admin/mfa", "/admin/forgot-password"] as const;

const base = "http://admin.invalid";

// AC-12: `next` stays inside /admin, so the sign in flow can never become an open redirect.
// Returns the path to go to, falling back to /admin for anything else.
export function safeAdminPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) {
    return adminHome;
  }
  // Browsers treat a backslash as a slash, and control characters are stripped before parsing.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return adminHome;

  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return adminHome;
  }
  if (url.origin !== base) return adminHome;

  const { pathname } = url;
  const inAdmin = pathname === adminHome || pathname.startsWith(`${adminHome}/`);
  const isAuthPage = authPages.some((page) => pathname === page || pathname.startsWith(`${page}/`));
  if (!inAdmin || isAuthPage) return adminHome;

  return `${pathname}${url.search}`;
}

// The sign in URL for a visitor who asked for `path`, carrying it as `next` when it is safe.
export function signInPath(options: { next?: string; reason?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.next !== undefined) params.set("next", safeAdminPath(options.next));
  if (options.reason) params.set("reason", options.reason);
  const query = params.toString();
  return query ? `/admin/sign-in?${query}` : "/admin/sign-in";
}

export function mfaPath(next?: string): string {
  return next === undefined
    ? "/admin/mfa"
    : `/admin/mfa?next=${encodeURIComponent(safeAdminPath(next))}`;
}
