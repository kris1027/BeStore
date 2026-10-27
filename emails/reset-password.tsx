import { AuthLinkEmail } from "./components/auth-link-email";
import type { EmailFrame } from "./components/layout";
import { fixtureFrame } from "./fixtures";

// spec 0012, AC-8 and AC-9: a customer's password reset, sent by the Send Email Hook. Users who
// run the store get no reset email at all (spec 0019, AC-8).

export type ResetPasswordProps = {
  readonly frame: EmailFrame;
  readonly resetUrl: string;
};

export const resetPasswordSubject = "Reset your password";

export function ResetPasswordEmail(props: ResetPasswordProps) {
  return (
    <AuthLinkEmail
      frame={props.frame}
      subject={resetPasswordSubject}
      intro={`Someone asked to reset the password for your ${props.frame.storeName} account. If it was you, open the link and choose a new password.`}
      href={props.resetUrl}
      label="Choose a new password"
      outro="The link works once and expires in one hour. If you did not ask for this, ignore this email; your password stays the same."
    />
  );
}

ResetPasswordEmail.PreviewProps = {
  frame: { ...fixtureFrame, greetingName: null },
  resetUrl: "http://localhost:3000/account/confirm?token_hash=pkce_example&type=recovery",
} satisfies ResetPasswordProps;

// React Email's preview server (`pnpm email:dev`) finds a template by its default export.
export default ResetPasswordEmail;
