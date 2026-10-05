// Pure: the money and unit rules of a refund (spec 0010, Refund math). Every amount is integer
// minor units computed from the order's own rows; the admin's typed amount is only checked
// against these numbers, never trusted to widen them.

export type RefundStatus = "pending" | "succeeded" | "failed";

export type MathLine = {
  readonly id: string;
  readonly quantity: number;
  readonly lineTotalCents: number;
};

export type MathRefund = {
  readonly status: RefundStatus;
  readonly amountCents: number;
  readonly includesShipping: boolean;
  readonly lines: readonly { readonly orderLineId: string; readonly quantity: number }[];
};

export type MathOrder = {
  readonly totalCents: number;
  readonly shippingCents: number;
  readonly lines: readonly MathLine[];
  readonly refunds: readonly MathRefund[];
};

export type ChosenLine = { readonly orderLineId: string; readonly quantity: number };

export type RefundState = "none" | "partial" | "full";

// A pending refund already holds its money: counting it here is what stops a second admin from
// refunding the same euros while the first request is still at Stripe.
export function reservedCents(refunds: readonly MathRefund[]): number {
  return refunds
    .filter((refund) => refund.status !== "failed")
    .reduce((sum, refund) => sum + refund.amountCents, 0);
}

export function remainingCents(order: MathOrder): number {
  return Math.max(0, order.totalCents - reservedCents(order.refunds));
}

// Units of each line already covered by a refund that did not fail.
export function refundedUnits(refunds: readonly MathRefund[], orderLineId: string): number {
  return refunds
    .filter((refund) => refund.status !== "failed")
    .flatMap((refund) => refund.lines)
    .filter((line) => line.orderLineId === orderLineId)
    .reduce((sum, line) => sum + line.quantity, 0);
}

export function refundableUnits(order: MathOrder, line: MathLine): number {
  return Math.max(0, line.quantity - refundedUnits(order.refunds, line.id));
}

// "Refund delivery" is offered once: until a refund that did not fail has included it.
export function shippingRefundable(order: MathOrder): boolean {
  return (
    order.shippingCents > 0 &&
    !order.refunds.some((refund) => refund.status !== "failed" && refund.includesShipping)
  );
}

// The value of q more units of a line with total T and quantity Q, r already refunded. The
// floors telescope, so refunding every unit, in any number of refunds, sums to exactly T.
export function lineRefundCents(
  totalCents: number,
  quantity: number,
  alreadyRefunded: number,
  more: number,
): number {
  return (
    Math.floor((totalCents * (alreadyRefunded + more)) / quantity) -
    Math.floor((totalCents * alreadyRefunded) / quantity)
  );
}

export function suggestedCents(
  order: MathOrder,
  chosen: readonly ChosenLine[],
  refundShipping: boolean,
): number {
  let sum = refundShipping && shippingRefundable(order) ? order.shippingCents : 0;
  for (const pick of chosen) {
    const line = order.lines.find((entry) => entry.id === pick.orderLineId);
    if (!line || pick.quantity <= 0) continue;
    const more = Math.min(pick.quantity, refundableUnits(order, line));
    sum += lineRefundCents(
      line.lineTotalCents,
      line.quantity,
      refundedUnits(order.refunds, line.id),
      more,
    );
  }
  return Math.min(sum, remainingCents(order));
}

export function refundState(totalCents: number, refundedCents: number): RefundState {
  if (refundedCents <= 0) return "none";
  return refundedCents >= totalCents ? "full" : "partial";
}

export type RefundRequest = {
  readonly lines: readonly ChosenLine[];
  readonly refundShipping: boolean;
  readonly amountCents: number;
};

export type RefundFieldErrors = Readonly<Record<string, readonly string[]>>;

// AC-9 and AC-11: the field errors of a refund request against the order as it is now (read
// under the order row lock), or null when it may go to Stripe. Field paths match the form:
// `lines.<orderLineId>`, `refundShipping`, `amount`.
export function refundRequestErrors(
  order: MathOrder,
  request: RefundRequest,
): RefundFieldErrors | null {
  const errors: Record<string, string[]> = {};
  const add = (path: string, message: string) => (errors[path] ??= []).push(message);

  const seen = new Set<string>();
  for (const pick of request.lines) {
    const line = order.lines.find((entry) => entry.id === pick.orderLineId);
    if (!line || seen.has(pick.orderLineId)) {
      add(`lines.${pick.orderLineId}`, "This item is not on the order.");
      continue;
    }
    seen.add(pick.orderLineId);
    const left = refundableUnits(order, line);
    if (pick.quantity > left) {
      add(
        `lines.${pick.orderLineId}`,
        left === 0
          ? "Every unit of this item is already refunded."
          : `At most ${left} can still be refunded.`,
      );
    }
  }
  if (request.refundShipping && !shippingRefundable(order)) {
    add("refundShipping", "Delivery is already refunded.");
  }

  const remaining = remainingCents(order);
  const goodwill = request.lines.length === 0 && !request.refundShipping;
  const cap = goodwill ? remaining : suggestedCents(order, request.lines, request.refundShipping);
  if (request.amountCents < 1) add("amount", "Enter an amount above 0.");
  else if (request.amountCents > cap) {
    add(
      "amount",
      goodwill
        ? "This is more than is left to refund."
        : "This is more than the chosen items and delivery are worth.",
    );
  }

  return Object.keys(errors).length === 0 ? null : errors;
}

export type CancelPlan = {
  readonly amountCents: number;
  readonly includesShipping: boolean;
  readonly lines: readonly {
    readonly orderLineId: string;
    readonly quantity: number;
    readonly restock: boolean;
  }[];
};

// AC-14: cancelling a paid order refunds everything left, whatever a goodwill refund took
// before, and covers every unit still refundable; delivery counts as included.
export function cancelPlan(order: MathOrder, restockLineIds: readonly string[]): CancelPlan {
  return {
    amountCents: remainingCents(order),
    includesShipping: shippingRefundable(order),
    lines: order.lines.flatMap((line) => {
      const quantity = refundableUnits(order, line);
      return quantity > 0
        ? [{ orderLineId: line.id, quantity, restock: restockLineIds.includes(line.id) }]
        : [];
    }),
  };
}

// AC-13: the units of one variant that may go back to stock, `available` being what the sale
// took minus what earlier refunds returned, handed out lowest order line id first.
export function allocateReturns(
  available: number,
  lines: readonly { readonly id: string; readonly quantity: number }[],
): readonly { readonly id: string; readonly returned: number }[] {
  let left = Math.max(0, available);
  return lines
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((line) => {
      const returned = Math.min(line.quantity, left);
      left -= returned;
      return { id: line.id, returned };
    });
}
