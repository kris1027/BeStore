import { render } from "react-email";

import type { EmailFrame } from "../../../emails/components/layout";
import { ConfirmSignupEmail, confirmSignupSubject } from "../../../emails/confirm-signup";
import { ResetPasswordEmail, resetPasswordSubject } from "../../../emails/reset-password";
import type { AuthEmailKind } from "./auth-hook";
import type { RenderedEmail } from "./render";

function element(kind: AuthEmailKind, frame: EmailFrame, link: string) {
  switch (kind) {
    case "confirm_signup":
      return {
        subject: confirmSignupSubject,
        node: <ConfirmSignupEmail frame={frame} confirmUrl={link} />,
      };
    case "customer_reset":
      return {
        subject: resetPasswordSubject,
        node: <ResetPasswordEmail frame={frame} resetUrl={link} />,
      };
  }
}

// spec 0012, AC-8: like the order emails, the plain text version comes from the same component.
export async function renderAuthEmail(
  kind: AuthEmailKind,
  frame: EmailFrame,
  link: string,
): Promise<RenderedEmail> {
  const { subject, node } = element(kind, frame, link);
  const [html, text] = await Promise.all([render(node), render(node, { plainText: true })]);
  return { subject, html, text };
}
