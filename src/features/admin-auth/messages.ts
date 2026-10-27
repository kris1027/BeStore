// Every user facing auth string (spec 0004, *Messages*). Query params carry only these keys and
// are mapped back here, so nothing from the URL is ever echoed onto the page.
export const authMessages = {
  invalid_credentials: "Email or password is incorrect.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  unavailable: "Sign in is unavailable right now. Try again shortly.",
  expired: "Your session has expired. Please sign in again.",
  signed_out: "You have signed out.",
} as const;

export type AuthMessageKey = keyof typeof authMessages;

export const fieldMessages = {
  emailRequired: "Enter your email address",
  emailInvalid: "Enter a valid email address",
  passwordRequired: "Enter your password",
} as const;

// The reasons the sign in page shows from its `reason` query param.
const signInReasons = ["expired", "signed_out"] as const;

export type SignInReason = (typeof signInReasons)[number];

export function signInReason(value: unknown): SignInReason | null {
  return signInReasons.find((reason) => reason === value) ?? null;
}
