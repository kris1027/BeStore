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

import { deleteProduct } from "../../actions/delete-product";
import { adminProductsPath } from "../../paths";
import { notFoundMessage } from "./messages";

const errorMessages = {
  on_order: "This product is on an order. Archive it instead.",
  is_active: "Hide this product before deleting it.",
  not_found: notFoundMessage,
} as const;

// spec 0009, AC-4: only offered for a product that is not active and on no order. Deleting is
// final, so it asks first, naming the product.
export function DeleteProductButton({
  productId,
  name,
}: {
  readonly productId: string;
  readonly name: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function confirm() {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteProduct({ productId });
      if (!result.ok) {
        setNotice(errorMessages[result.error.code]);
        return;
      }
      setOpen(false);
      toast.add({ title: "Product deleted", description: name, type: "success" });
      router.push(adminProductsPath);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setNotice(null);
      }}
    >
      <DialogTrigger render={<Button type="button" variant="destructive" disabled={!hydrated} />}>
        <Trash2Icon data-icon="inline-start" aria-hidden="true" />
        Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            This removes the product with its variants, images, stock history and category links,
            and takes it out of any cart. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <FormNotice message={notice} />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Delete product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
