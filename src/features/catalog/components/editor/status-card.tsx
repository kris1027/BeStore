"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

import { changeProductStatus } from "../../actions/change-status";
import {
  type ProductStatus,
  type StatusAction,
  statusActions,
  statusActionTarget,
} from "../../status";
import { notFoundMessage } from "./messages";

const statusLabels: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

const statusHelp: Record<ProductStatus, string> = {
  draft: "Hidden from the storefront. Publish it when it is ready to sell.",
  active: "On the storefront. Hide it to take it off without losing anything.",
  archived: "Retired. Restore it as a draft if you sell it again.",
};

const actionLabels: Record<StatusAction, string> = {
  publish: "Publish",
  hide: "Hide",
  archive: "Archive",
  restore: "Restore",
};

const doneTitles: Record<StatusAction, string> = {
  publish: "Product published",
  hide: "Product hidden",
  archive: "Product archived",
  restore: "Product restored as a draft",
};

const errorMessages = {
  no_variants: "Restore a variant before publishing. A live product needs at least one variant.",
  invalid_transition: "This product's status changed meanwhile. Reload to see the latest.",
  not_found: notFoundMessage,
} as const;

// spec 0009, AC-2: the status and the buttons that apply to it.
export function StatusCard({
  productId,
  status,
  deleteSlot,
}: {
  readonly productId: string;
  readonly status: ProductStatus;
  // The Delete button, when this product may be deleted (AC-4).
  readonly deleteSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<StatusAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(action: StatusAction) {
    setNotice(null);
    setRunning(action);
    startTransition(async () => {
      const result = await changeProductStatus({ productId, to: statusActionTarget(action) });
      setRunning(null);
      if (!result.ok) {
        setNotice(errorMessages[result.error.code]);
        return;
      }
      toast.add({ title: doneTitles[action], type: "success" });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Status</h2>
        </CardTitle>
        <CardDescription className="flex flex-col items-start gap-2">
          <Badge variant={status === "active" ? "secondary" : "outline"}>
            {statusLabels[status]}
          </Badge>
          {statusHelp[status]}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormNotice message={notice} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {statusActions(status).map((action, index) => (
          <Button
            key={action}
            type="button"
            variant={index === 0 ? "default" : "outline"}
            disabled={pending}
            onClick={() => run(action)}
          >
            {running === action ? <Spinner data-icon="inline-start" /> : null}
            {actionLabels[action]}
          </Button>
        ))}
        {deleteSlot}
      </CardFooter>
    </Card>
  );
}
