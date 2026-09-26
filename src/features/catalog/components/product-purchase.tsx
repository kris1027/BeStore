"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Price } from "@/components/price";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { addToCart } from "@/features/cart/actions";
import { type Availability, quantityLimit } from "@/lib/availability";

import { initialVariant, isValueAvailable, type Selection, variantFor, withValue } from "../picker";
import type { ProductOptionTypeView, ProductVariantView } from "../queries";

const cartPath = "/cart";

function availabilityText(state: Availability | undefined): string {
  if (!state) return "Not available in this combination";
  switch (state.kind) {
    case "in_stock":
      return "In stock";
    case "low":
      return `Only ${state.left} left`;
    case "sold_out":
      return "Sold out";
  }
}

const addErrors = {
  invalid: "Choose a quantity from 1 to 10.",
  unavailable: "This item is no longer available.",
  sold_out: "This item just sold out.",
} as const;

// spec 0005, AC-7 and AC-8: the picker, the quantity and Add to cart.
export function ProductPurchase({
  optionTypes,
  variants,
}: {
  readonly optionTypes: readonly ProductOptionTypeView[];
  readonly variants: readonly ProductVariantView[];
}) {
  const router = useRouter();
  const id = useId();
  const [selection, setSelection] = useState<Selection>(
    () => initialVariant(variants)?.optionValueIds ?? [],
  );
  const [quantity, setQuantity] = useState("1");
  const [pending, startTransition] = useTransition();

  const variant = variantFor(variants, selection);
  const limit = variant ? quantityLimit(variant.availability) : 0;
  const canAdd = variant !== undefined && limit > 0;
  const priceCents = variant?.priceCents ?? Math.min(...variants.map((v) => v.priceCents));

  function add() {
    if (!variant) return;
    const wanted = Math.min(Math.max(Number.parseInt(quantity, 10) || 1, 1), limit);
    setQuantity(String(wanted));
    startTransition(async () => {
      const result = await addToCart({ variantId: variant.id, quantity: wanted });
      if (!result.ok) {
        toast.add({ title: "Not added", description: addErrors[result.error], type: "error" });
        return;
      }
      const { cappedTo } = result.data;
      toast.add({
        title: "Added to cart",
        description:
          cappedTo === undefined
            ? `Your cart now has ${result.data.cartQuantity} ${result.data.cartQuantity === 1 ? "item" : "items"}.`
            : `Only ${cappedTo} available, so your cart has ${cappedTo} of this.`,
        type: cappedTo === undefined ? "success" : "warning",
        actionProps: { children: "View cart", onClick: () => router.push(cartPath) },
      });
    });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      {/* Price and availability change with the picker, so screen readers hear the update. */}
      <div className="flex flex-col gap-1" aria-live="polite" aria-atomic="true">
        <p className="text-xl">
          <span className="sr-only">Price: </span>
          <Price cents={priceCents} />
        </p>
        <p className="text-sm text-muted-foreground">{availabilityText(variant?.availability)}</p>
      </div>

      {optionTypes.map((type, t) => (
        <FieldSet key={type.id}>
          <FieldLegend variant="label">{type.name}</FieldLegend>
          <RadioGroup
            value={selection[t] ?? null}
            onValueChange={(value) => {
              if (typeof value === "string")
                setSelection((current) => withValue(current, t, value));
            }}
            className="flex flex-wrap gap-x-6 gap-y-3"
          >
            {type.values.map((value) => {
              const available = isValueAvailable(variants, t, value.id);
              const itemId = `${id}-${value.id}`;
              return (
                <Field
                  key={value.id}
                  orientation="horizontal"
                  className="w-auto"
                  data-disabled={available ? undefined : true}
                >
                  <RadioGroupItem value={value.id} id={itemId} disabled={!available} />
                  <FieldLabel htmlFor={itemId} className="font-normal">
                    {value.value}
                    {available ? null : <span className="text-muted-foreground">(sold out)</span>}
                  </FieldLabel>
                </Field>
              );
            })}
          </RadioGroup>
        </FieldSet>
      ))}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="sm:w-28">
          <FieldLabel htmlFor={`${id}-quantity`}>Quantity</FieldLabel>
          <Input
            id={`${id}-quantity`}
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(limit, 1)}
            value={quantity}
            disabled={!canAdd}
            aria-describedby={`${id}-quantity-help`}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-11"
          />
          <FieldDescription id={`${id}-quantity-help`} className="sr-only">
            Up to {Math.max(limit, 1)}
          </FieldDescription>
        </Field>
        <Button
          type="submit"
          size="lg"
          className="h-11 px-6 sm:flex-1"
          disabled={!canAdd || pending}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {canAdd ? "Add to cart" : "Sold out"}
        </Button>
      </div>
    </form>
  );
}
