"use client";

import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { MAX_LINE_QUANTITY } from "@/lib/availability";
import type { LineFlag } from "@/lib/cart/cart-lines";

import { type CartLineError, removeCartItem, setCartItemQuantity } from "../actions";

const lineErrors: Record<CartLineError, string> = {
  invalid: "Choose a quantity from 1 to 10.",
  not_found: "This item is no longer in your cart. Reload the page.",
  unavailable: "This item is no longer available. Remove it to continue.",
  sold_out: "This item sold out. Remove it to continue.",
};

export function flagText(flag: LineFlag): string | null {
  switch (flag.kind) {
    case "ok":
      return null;
    case "unavailable":
      return "No longer available";
    case "sold_out":
      return "Sold out";
    case "insufficient":
      return `Only ${flag.left} left`;
  }
}

// spec 0005, AC-10 and AC-11: change the quantity, remove, or apply the one click fix of a
// flagged line. Every change is saved at once and announced.
export function CartLineControls({
  itemId,
  quantity,
  flag,
  productLabel,
}: {
  readonly itemId: string;
  readonly quantity: number;
  readonly flag: LineFlag;
  // Name and variant, for the controls' accessible names.
  readonly productLabel: string;
}) {
  const [pending, startTransition] = useTransition();

  function setQuantity(next: number) {
    startTransition(async () => {
      const result = await setCartItemQuantity({ itemId, quantity: next });
      if (!result.ok) {
        toast.add({ title: "Not changed", description: lineErrors[result.error], type: "error" });
      } else if (result.data.cappedTo !== undefined) {
        toast.add({
          title: `Only ${result.data.cappedTo} available`,
          description: `${productLabel} is set to ${result.data.cappedTo}.`,
          type: "warning",
        });
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeCartItem({ itemId });
      toast.add(
        result.ok
          ? { title: "Removed from cart", description: productLabel, type: "success" }
          : { title: "Not removed", description: lineErrors[result.error], type: "error" },
      );
    });
  }

  const flagged = flagText(flag);
  const blocked = flag.kind === "unavailable" || flag.kind === "sold_out";

  return (
    <div className="flex flex-col gap-3">
      {flagged ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <p className="font-medium text-destructive">{flagged}</p>
          {flag.kind === "insufficient" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setQuantity(flag.left)}
            >
              Set to {flag.left}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={remove}>
              Remove
              <span className="sr-only"> {productLabel}</span>
            </Button>
          )}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {blocked ? null : (
          <div
            role="group"
            aria-label={`Quantity of ${productLabel}`}
            className="flex items-center rounded-md border border-input"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Decrease quantity of ${productLabel}`}
              disabled={pending || quantity <= 1}
              onClick={() => setQuantity(quantity - 1)}
            >
              <MinusIcon aria-hidden="true" />
            </Button>
            <output aria-live="polite" className="w-8 text-center tabular-nums">
              {quantity}
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Increase quantity of ${productLabel}`}
              disabled={pending || quantity >= MAX_LINE_QUANTITY}
              onClick={() => setQuantity(quantity + 1)}
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </div>
        )}
        {blocked ? null : (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={pending}
            onClick={remove}
          >
            <Trash2Icon data-icon="inline-start" aria-hidden="true" />
            Remove<span className="sr-only"> {productLabel}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
