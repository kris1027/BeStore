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

import { deleteCategory } from "../actions/delete-category";
import { adminCategoriesPath } from "../paths";

// spec 0009, AC-19: asks first, saying how many products the category holds; the products stay.
export function DeleteCategoryButton({
  categoryId,
  name,
  productCount,
}: {
  readonly categoryId: string;
  readonly name: string;
  readonly productCount: number;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function confirm() {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteCategory({ categoryId });
      if (!result.ok) {
        setNotice("This category no longer exists. Go back to the categories.");
        return;
      }
      setOpen(false);
      toast.add({ title: "Category deleted", description: name, type: "success" });
      router.push(adminCategoriesPath);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="destructive" disabled={!hydrated} />}>
        <Trash2Icon data-icon="inline-start" aria-hidden="true" />
        Delete category
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            {productCount === 0
              ? "It holds no products."
              : `It holds ${productCount} ${productCount === 1 ? "product" : "products"}. They stay in the catalog, just no longer in this category.`}{" "}
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <FormNotice message={notice} />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Delete category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
