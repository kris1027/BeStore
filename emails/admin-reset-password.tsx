import { Text } from "react-email";

import { ActionLink } from "./components/action-link";
import { type EmailFrame, EmailLayout, textStyle } from "./components/layout";
import { fixtureFrame } from "./fixtures";

// spec 0004, AC-9, sent by the Send Email Hook since spec 0012 (AC-8): the wording of the old
// Supabase template. The link always goes to /auth/confirm, where the reset waits behind the
// authenticator, whatever redirect the request asked for.

export type AdminResetPasswordProps = {
  readonly frame: EmailFrame;
  readonly resetUrl: string;
};

export const adminResetPasswordSubject = "Reset your admin password";

export function AdminResetPasswordEmail(props: AdminResetPasswordProps) {
  return (
    <EmailLayout
      frame={props.frame}
      preview={adminResetPasswordSubject}
      heading={adminResetPasswordSubject}
    >
      <Text style={textStyle}>
        Someone asked to reset the password for this admin account. If it was you, open the link
        below and follow the steps. You will need your authenticator app.
      </Text>
      <ActionLink href={props.resetUrl} label="Reset your password" />
      <Text style={textStyle}>
        The link works once and expires in one hour. If you did not ask for this, you can ignore
        this email; your password stays the same.
      </Text>
    </EmailLayout>
  );
}

AdminResetPasswordEmail.PreviewProps = {
  frame: { ...fixtureFrame, greetingName: null },
  resetUrl: "http://localhost:3000/auth/confirm?token_hash=pkce_example&type=recovery",
} satisfies AdminResetPasswordProps;

// React Email's preview server (`pnpm email:dev`) finds a template by its default export.
export default AdminResetPasswordEmail;
