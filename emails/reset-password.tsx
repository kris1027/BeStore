import { Text } from "react-email";

import { ActionLink } from "./components/action-link";
import { type EmailFrame, EmailLayout, textStyle } from "./components/layout";
import { fixtureFrame } from "./fixtures";

// spec 0012, AC-8 and AC-9: a customer's password reset, sent by the Send Email Hook. Users who
// run the store get admin-reset-password.tsx instead.

export type ResetPasswordProps = {
  readonly frame: EmailFrame;
  readonly resetUrl: string;
};

export const resetPasswordSubject = "Reset your password";

export function ResetPasswordEmail(props: ResetPasswordProps) {
  return (
    <EmailLayout frame={props.frame} preview={resetPasswordSubject} heading={resetPasswordSubject}>
      <Text style={textStyle}>
        Someone asked to reset the password for your {props.frame.storeName} account. If it was you,
        open the link and choose a new password.
      </Text>
      <ActionLink href={props.resetUrl} label="Choose a new password" />
      <Text style={textStyle}>
        The link works once and expires in one hour. If you did not ask for this, ignore this email;
        your password stays the same.
      </Text>
    </EmailLayout>
  );
}

ResetPasswordEmail.PreviewProps = {
  frame: { ...fixtureFrame, greetingName: null },
  resetUrl: "http://localhost:3000/account/confirm?token_hash=pkce_example&type=recovery",
} satisfies ResetPasswordProps;

// React Email's preview server (`pnpm email:dev`) finds a template by its default export.
export default ResetPasswordEmail;
