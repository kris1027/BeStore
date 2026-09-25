// Every user facing auth string (spec 0004, *Messages*). Query params carry only these keys and
// are mapped back here, so nothing from the URL is ever echoed onto the page.
export const authMessages = {
  invalid_credentials: "Email or password is incorrect.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  unavailable: "Sign in is unavailable right now. Try again shortly.",
  invalid_code: "That code is incorrect. Try the current code from your app.",
  too_many_codes: "Too many incorrect codes. Please sign in again.",
  mfa_not_set_up: "Your authenticator is not set up. Contact the store owner.",
  expired: "Your session has expired. Please sign in again.",
  signed_out: "You have signed out.",
  invalid_link: "That link is invalid or has expired. Request a new one.",
  reset_sent: "If that email belongs to an admin, a reset link is on its way.",
  same_password: "Choose a password you have not used here before.",
  mismatch: "The passwords do not match.",
} as const;

export type AuthMessageKey = keyof typeof authMessages;

export const fieldMessages = {
  emailRequired: "Enter your email address",
  emailInvalid: "Enter a valid email address",
  passwordRequired: "Enter your password",
  codeRequired: "Enter the 6 digit code",
} as const;

export const passwordRuleMessages = {
  length: "At least 8 characters",
  lower: "A lower case letter",
  upper: "An upper case letter",
  digit: "A digit",
  symbol: "A symbol",
} as const;

export type PasswordRule = keyof typeof passwordRuleMessages;

// The reasons the sign in page shows from its `reason` query param.
const signInReasons = ["expired", "signed_out", "invalid_link", "too_many_codes"] as const;

export type SignInReason = (typeof signInReasons)[number];

export function signInReason(value: unknown): SignInReason | null {
  return signInReasons.find((reason) => reason === value) ?? null;
}
