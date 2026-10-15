import { AuthLinkEmail } from "./components/auth-link-email";
import type { EmailFrame } from "./components/layout";
import { fixtureFrame } from "./fixtures";

// spec 0012, AC-1, AC-2 and AC-8: sent by the Send Email Hook for a sign up. The link opens a page
// with a Continue button, so a mail scanner that opens it spends nothing.

export type ConfirmSignupProps = {
  readonly frame: EmailFrame;
  readonly confirmUrl: string;
};

export const confirmSignupSubject = "Confirm your email";

export function ConfirmSignupEmail(props: ConfirmSignupProps) {
  return (
    <AuthLinkEmail
      frame={props.frame}
      subject={confirmSignupSubject}
      intro={`Someone asked to create a ${props.frame.storeName} account with this email. If it was you, confirm your email, then choose your password.`}
      href={props.confirmUrl}
      label="Confirm your email"
      outro="The link works once and expires in one hour. If you did not ask for this, ignore this email and no account is made."
    />
  );
}

ConfirmSignupEmail.PreviewProps = {
  frame: { ...fixtureFrame, greetingName: null },
  confirmUrl: "http://localhost:3000/account/confirm?token_hash=pkce_example&type=signup",
} satisfies ConfirmSignupProps;

// React Email's preview server (`pnpm email:dev`) finds a template by its default export.
export default ConfirmSignupEmail;
