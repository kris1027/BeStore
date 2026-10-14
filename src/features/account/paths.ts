// Pure: the account URLs (spec 0012, AC-13) and the `next` rule for sign in (AC-4).

export const accountPaths = {
  home: "/account",
  signIn: "/account/sign-in",
  signUp: "/account/sign-up",
  forgotPassword: "/account/forgot-password",
  confirm: "/account/confirm",
  setPassword: "/account/set-password",
  addresses: "/account/addresses",
  settings: "/account/settings",
} as const;

export function accountOrderPath(number: number): string {
  return `/account/orders/${number}`;
}

// The public pages under /account; every other one needs a signed in customer.
export const accountAuthPages: readonly string[] = [
  accountPaths.signIn,
  accountPaths.signUp,
  accountPaths.forgotPassword,
  accountPaths.confirm,
];

export function isAccountPath(pathname: string): boolean {
  return pathname === accountPaths.home || pathname.startsWith(`${accountPaths.home}/`);
}

export function isAccountAuthPage(pathname: string): boolean {
  return accountAuthPages.includes(pathname);
}

export function signInPath(next?: string): string {
  return next === undefined
    ? accountPaths.signIn
    : `${accountPaths.signIn}?next=${encodeURIComponent(next)}`;
}

// AC-4: where sign in may send the customer. Decoded once more (so %2F%2F cannot hide a second
// slash), one leading slash, no backslash, no `//`, no scheme, and either exactly /checkout or a
// page under /account that is not an auth page. Anything else is null, which means /account.
export function safeAccountNext(next: unknown): string | null {
  if (typeof next !== "string" || next === "") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("//")) return null;
  // Control characters (a tab or newline inside a URL) are dropped by browsers, so refuse them.
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  const pathname = decoded.split(/[?#]/)[0] ?? "";
  if (pathname.includes(":")) return null;
  if (pathname === "/checkout") return decoded;
  if (isAccountPath(pathname) && !isAccountAuthPage(pathname)) return decoded;
  return null;
}
