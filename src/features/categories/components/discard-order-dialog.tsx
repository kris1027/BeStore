"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// spec 0013, AC-23: Add or Remove reloads the list in its saved order, so with an unsaved order
// it asks first. Open while `action` is set.
export function DiscardOrderDialog({
  action,
  onCancel,
  onConfirm,
}: {
  readonly action: "add" | "remove" | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog open={action !== null} onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard the unsaved order?</DialogTitle>
          <DialogDescription>
            {action === "add" ? "Adding" : "Removing"} a product reloads the list in its saved
            order, so the order you arranged is lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep arranging</DialogClose>
          <Button type="button" onClick={onConfirm}>
            Discard and {action === "add" ? "add" : "remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
