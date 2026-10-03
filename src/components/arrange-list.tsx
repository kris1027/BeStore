"use client";

import { RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { SortableList } from "@/components/sortable-list";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/result";

export type ArrangeEntry = {
  readonly id: string;
  readonly name: string;
  // The item's own page, when it has one: the name links there.
  readonly href?: string;
  readonly detail?: React.ReactNode;
  readonly thumbnail?: string;
};

export const listChangedMessage = "The list changed. Reload to see the latest.";

// spec 0009, AC-20: a list arranged by drag and drop or keyboard, where every drop saves at once
// (products on /admin/products/arrange, categories on /admin/categories). A refused save puts the
// list back and asks for a reload, since the order on screen is no longer the stored one.
export function ArrangeList({
  label,
  items,
  save,
}: {
  readonly label: string;
  readonly items: readonly ArrangeEntry[];
  // A server action taking the full ordered list of ids.
  readonly save: (input: {
    readonly orderedIds: readonly string[];
  }) => Promise<ActionResult<null, unknown>>;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<readonly string[]>(() => items.map((item) => item.id));
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const byId = new Map(items.map((item) => [item.id, item]));
  const shown = order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

  function reorder(next: readonly string[]) {
    const previous = order;
    setOrder(next);
    setNotice(null);
    setStatus(null);
    startTransition(async () => {
      const result = await save({ orderedIds: next });
      if (result.ok) {
        setStatus("Order saved.");
        return;
      }
      setOrder(previous);
      setNotice(listChangedMessage);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FormNotice message={notice} />
      {notice ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => router.refresh()}
        >
          <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
          Reload
        </Button>
      ) : null}
      <SortableList
        label={label}
        items={shown}
        disabled={pending}
        onReorder={reorder}
        renderItem={(item, handle, index) => (
          <div className="flex items-center gap-3 rounded-md border bg-card p-2 pr-3">
            {handle}
            <span className="w-6 text-right text-sm text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            {item.thumbnail ? (
              <div className="relative aspect-product w-10 shrink-0 overflow-hidden rounded-sm bg-muted">
                {/* A small, fixed size thumbnail; next/image adds nothing at this size. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.thumbnail} alt="" className="size-full object-cover" />
              </div>
            ) : null}
            {item.href ? (
              <Link
                href={item.href}
                className="min-w-0 flex-1 truncate font-medium underline-offset-4 hover:underline"
              >
                {item.name}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
            )}
            {item.detail}
          </div>
        )}
      />
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        {pending ? (
          <>
            <Spinner />
            Saving the order…
          </>
        ) : (
          status
        )}
      </p>
    </div>
  );
}
