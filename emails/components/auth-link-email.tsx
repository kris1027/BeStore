import { Text } from "react-email";

import { ActionLink } from "./action-link";
import { type EmailFrame, EmailLayout, textStyle } from "./layout";

// The shape every auth email shares: why it came, the one link, and what happens if it was not you.
export function AuthLinkEmail(props: {
  readonly frame: EmailFrame;
  readonly subject: string;
  readonly intro: string;
  readonly href: string;
  readonly label: string;
  readonly outro: string;
}) {
  return (
    <EmailLayout frame={props.frame} preview={props.subject} heading={props.subject}>
      <Text style={textStyle}>{props.intro}</Text>
      <ActionLink href={props.href} label={props.label} />
      <Text style={textStyle}>{props.outro}</Text>
    </EmailLayout>
  );
}
