// Every user facing account string (spec 0012). Query params carry only these keys and are mapped
// back here, so nothing from the URL is ever echoed onto the page.

export const accountMessages = {
  // AC-1
  checkEmailTitle: "Check your email",
  checkEmailBody:
    "If this email can be used for an account, we sent a link to it. Open the link to confirm your email, then choose your password.",
  linkResent: "If this email can be used for an account, we sent a new link.",
  // AC-2
  linkExpired: "This link has expired or was already used.",
  // AC-3
  leakedPassword: "This password has appeared in a data leak. Choose another.",
  samePassword: "Choose a password you have not used here before.",
  weakPassword: "This password is not strong enough. Check the rules below and try again.",
  sessionMissing: "Your link has run out. Sign in, or ask for a new link with Forgot password.",
  // AC-4
  invalidCredentials: "That email and password do not match.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  unavailable: "Something went wrong. Try again later.",
  // AC-9
  resetSent: "If there is an account for that email, a reset link is on its way.",
  // AC-19
  runsTheStorePassword: "This account also runs the store, so its password cannot be changed here.",
  wrongCurrentPassword: "Your current password is not right.",
  passwordChanged: "Your password is changed.",
  // AC-20
  runsTheStoreDelete: "This account also runs the store, so it cannot be deleted here.",
  deleteFailed: "We could not delete your account. Try again.",
  deleted: "Your account is deleted.",
  // AC-18
  profileSaved: "Your details are saved.",
  emailChange: "To change your email, contact us.",
  mismatch: "The passwords do not match.",
} as const;

export const fieldMessages = {
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter a valid email address.",
  passwordRequired: "Enter your password.",
} as const;

// The notices /account shows from its `notice` query param (AC-3).
const accountNotices = {
  ready: "Your account is ready.",
  password_changed: accountMessages.passwordChanged,
} as const;

export type AccountNotice = keyof typeof accountNotices;

export function accountNotice(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(accountNotices, value)
    ? accountNotices[value as AccountNotice]
    : null;
}
