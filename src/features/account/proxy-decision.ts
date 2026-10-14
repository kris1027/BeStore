import { isAccountAuthPage, isAccountPath, signInPath } from "./paths";

export type AccountProxyInput = {
  readonly pathname: string;
  readonly search: string;
  // A server action POST (it carries the `Next-Action` header).
  readonly isServerAction: boolean;
  // Whether getClaims() found a valid session.
  readonly signedIn: boolean;
};

export type AccountProxyDecision =
  { readonly kind: "continue" } | { readonly kind: "redirect"; readonly to: string };

// spec 0012, AC-13: the first gate only. A signed out visitor on an account page goes to sign in
// before anything renders; the page's own requireCustomer() still decides. A redirect answering an
// action POST breaks the client, so actions answer for themselves.
export function decideAccountProxy(input: AccountProxyInput): AccountProxyDecision {
  const { pathname } = input;
  if (!isAccountPath(pathname) || isAccountAuthPage(pathname)) return { kind: "continue" };
  if (input.signedIn || input.isServerAction) return { kind: "continue" };
  return { kind: "redirect", to: signInPath(`${pathname}${input.search}`) };
}

// Account pages and their redirects never come back from a cache, so Back after sign out shows
// nothing (Security model).
export function isNoStorePath(pathname: string): boolean {
  return isAccountPath(pathname);
}
