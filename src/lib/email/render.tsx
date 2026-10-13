import { render } from "react-email";

import {
  OrderConfirmationEmail,
  orderConfirmationSubject,
} from "../../../emails/order-confirmation";
import { OrderRefundedEmail, orderRefundedSubject } from "../../../emails/order-refunded";
import { OrderShippedEmail, orderShippedSubject } from "../../../emails/order-shipped";
import type { EmailContent } from "./props";

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

function element(content: EmailContent) {
  switch (content.kind) {
    case "order_confirmation":
      return {
        subject: orderConfirmationSubject(content.props.orderNumber),
        node: <OrderConfirmationEmail {...content.props} />,
      };
    case "order_shipped":
      return {
        subject: orderShippedSubject(content.props.orderNumber),
        node: <OrderShippedEmail {...content.props} />,
      };
    case "order_refunded":
      return {
        subject: orderRefundedSubject(content.props.orderNumber, content.props.cancelled),
        node: <OrderRefundedEmail {...content.props} />,
      };
  }
}

// spec 0011, AC-7: the plain text version comes from the same component, never written by hand.
export async function renderEmail(content: EmailContent): Promise<RenderedEmail> {
  const { subject, node } = element(content);
  const [html, text] = await Promise.all([render(node), render(node, { plainText: true })]);
  return { subject, html, text };
}
