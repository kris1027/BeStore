"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
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

import { deleteDiscountCode } from "../actions/delete-discount-code";
import { adminDiscountsPath } from "../paths";

const messages = {
  used: "This code has been used. Deactivate it instead.",
  not_found: "This code no longer exists. Go back to the codes.",
} as const;

// spec 0014, AC-13: offered only while the code was never used; the action checks again.
export function DeleteDiscountButton({ id, code }: { readonly id: string; readonly code: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function confirm() {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteDiscountCode({ id });
      if (!result.ok) {
        setNotice(messages[result.error.code]);
        return;
      }
      setOpen(false);
      toast.add({ title: "Code deleted", description: code, type: "success" });
      router.push(adminDiscountsPath);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="destructive" disabled={!hydrated} />}>
        <Trash2Icon data-icon="inline-start" aria-hidden="true" />
        Delete code
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {code}?</DialogTitle>
          <DialogDescription>
            No order has used it. Customers can no longer type it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <FormNotice message={notice} />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Delete code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
