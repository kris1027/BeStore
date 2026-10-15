"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";
import { MAX_SAVED_ADDRESSES } from "@/lib/customer/address-rules";
import { applyFieldErrors } from "@/lib/form-errors";
import { shippingAddressSchema, type StoreCountry } from "@/lib/shipping/address";

import { type AddressError, createAddress, updateAddress } from "../actions/addresses";
import {
  AddressFormFields,
  type AddressFormValues,
  emptyAddressValues,
} from "./address-form-fields";

function notice(error: AddressError): string | null {
  switch (error.code) {
    case "limit_reached":
      return `You can save up to ${MAX_SAVED_ADDRESSES} addresses.`;
    case "not_found":
      return "This address is no longer saved. Close this and look again.";
    case "validation":
      return null;
  }
}

// spec 0012, AC-14: add or edit one saved address in a dialog.
export function AddressDialog({
  mode,
  country,
  countryName,
  address,
  trigger,
  triggerLabel,
}: {
  readonly mode: "add" | "edit";
  readonly country: StoreCountry;
  readonly countryName: string;
  // The saved address being edited.
  readonly address?: {
    readonly id: string;
    readonly values: AddressFormValues;
    readonly label: string;
  };
  readonly trigger: React.ReactNode;
  // A fuller name for the trigger when the page lists several (the visible words come first).
  readonly triggerLabel?: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const schema = useMemo(() => shippingAddressSchema(country), [country]);
  const defaults = address?.values ?? emptyAddressValues;
  const form = useForm({ resolver: zodResolver(schema), defaultValues: defaults });
  const { errors } = form.formState;
  const idPrefix = mode === "add" ? "address-new" : `address-${address?.id ?? ""}`;

  const onSubmit = form.handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result =
        mode === "add" ? await createAddress(values) : await updateAddress(address?.id, values);
      if (result.ok) {
        toast.add({ title: mode === "add" ? "Address saved" : "Address updated", type: "success" });
        setOpen(false);
        return;
      }
      if (result.error.code === "validation") {
        applyFieldErrors(form.setError, result.error.fields);
        return;
      }
      setMessage(notice(result.error));
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMessage(null);
          form.reset(defaults);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={mode === "add" ? "default" : "outline"}
            aria-label={triggerLabel}
            disabled={!hydrated}
          />
        }
      >
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{mode === "add" ? "Add an address" : "Edit address"}</DialogTitle>
            <DialogDescription>
              {mode === "add"
                ? "Checkout can fill it in for you."
                : `Changes apply to future orders only. ${address?.label ?? ""}`}
            </DialogDescription>
          </DialogHeader>
          <FormNotice message={message} />
          <AddressFormFields
            idPrefix={idPrefix}
            register={form.register}
            errors={errors}
            countryName={countryName}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save address
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
