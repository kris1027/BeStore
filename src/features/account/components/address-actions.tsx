"use client";

import { useState, useTransition } from "react";

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

import { deleteAddress, setDefaultAddress } from "../actions/addresses";

const goneMessage = "This address is no longer saved. Reload the page to see your addresses.";

// spec 0012, AC-14: "Make default" for one saved address.
export function MakeDefaultButton({ id, label }: { readonly id: string; readonly label: string }) {
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        aria-label={`Make default: ${label}`}
        disabled={pending || !hydrated}
        onClick={() =>
          startTransition(async () => {
            const result = await setDefaultAddress(id);
            if (result.ok) toast.add({ title: "Default address changed", type: "success" });
            else setMessage(goneMessage);
          })
        }
      >
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Make default
      </Button>
      <FormNotice message={message} />
    </div>
  );
}

// Delete asks first; the default moves to the newest remaining address.
export function DeleteAddressButton({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMessage(null);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            aria-label={`Delete: ${label}`}
            disabled={!hydrated}
          />
        }
      >
        Delete
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this address?</DialogTitle>
          <DialogDescription>{label}. Orders already placed keep their address.</DialogDescription>
        </DialogHeader>
        <FormNotice message={message} />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteAddress(id);
                if (result.ok) {
                  toast.add({ title: "Address deleted", type: "success" });
                  setOpen(false);
                } else {
                  setMessage(goneMessage);
                }
              })
            }
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Delete address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
