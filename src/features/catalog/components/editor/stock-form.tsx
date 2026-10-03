"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";

import { adjustStock } from "../../actions/adjust-stock";
import { MAX_STOCK, NOTE_MAX_LENGTH, pathErrors, stockSchema } from "../../schemas";
import { notFoundMessage } from "./messages";

type StockRow = { readonly variantId: string; readonly label: string; readonly stock: number };

type FormState = { rows: { next: string; note: string }[] };

const archivedMeanwhile = "This variant was archived meanwhile. Reload to see the latest.";

// spec 0009, AC-10: a counted number per variant, saved only while each row still holds the
// count this page showed. A refused row adopts the count it has now, so the next save checks
// against that instead.
export function StockForm({
  productId,
  rows,
}: {
  readonly productId: string;
  readonly rows: readonly StockRow[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [expected, setExpected] = useState<Readonly<Record<string, number>>>(() =>
    Object.fromEntries(rows.map((row) => [row.variantId, row.stock])),
  );
  const form = useForm<FormState>({
    defaultValues: { rows: rows.map((row) => ({ next: String(row.stock), note: "" })) },
  });
  const { errors } = form.formState;

  function focus(index: number) {
    document.getElementById(`stock-${index}-next`)?.focus();
  }

  function submit() {
    setNotice(null);
    form.clearErrors();
    const values = form.getValues();
    const payload = {
      productId,
      rows: rows.map((row, index) => ({
        variantId: row.variantId,
        expected: expected[row.variantId] ?? row.stock,
        next: values.rows[index]?.next ?? "",
        note: values.rows[index]?.note ?? "",
      })),
    };
    const parsed = stockSchema.safeParse(payload);
    if (!parsed.success) {
      let first: number | null = null;
      for (const [path, messages] of Object.entries(pathErrors(parsed.error))) {
        const match = /^rows\.(\d+)\.(next|note)$/.exec(path);
        if (!match) continue;
        const index = Number(match[1]);
        form.setError(`rows.${index}.${match[2] as "next" | "note"}`, {
          type: "validate",
          message: messages[0],
        });
        first ??= index;
      }
      if (first !== null) focus(first);
      return;
    }

    startTransition(async () => {
      const result = await adjustStock(payload);
      if (result.ok) {
        toast.add({ title: "Stock saved", type: "success" });
        router.refresh();
        return;
      }
      switch (result.error.code) {
        case "validation":
          setNotice("Check the highlighted rows and save again.");
          return;
        case "not_found":
          setNotice(notFoundMessage);
          return;
        case "moved": {
          const moved = result.error.rows;
          const now = { ...expected };
          let first: number | null = null;
          for (const row of moved) {
            const index = rows.findIndex((entry) => entry.variantId === row.variantId);
            if (index < 0) continue;
            if (row.now !== null && !row.archived) now[row.variantId] = row.now;
            form.setError(`rows.${index}.next`, {
              type: "server",
              message:
                row.archived || row.now === null
                  ? archivedMeanwhile
                  : `Stock is now ${row.now}. Check it and save again.`,
            });
            first ??= index;
          }
          setExpected(now);
          setNotice("Nothing was saved. Stock changed on the rows marked below.");
          if (first !== null) focus(first);
          return;
        }
      }
    });
  }

  return (
    <form
      noValidate
      aria-label="Stock"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <FormNotice message={notice} />
      <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Stock counts" }}>
        <TableCaption className="sr-only">Stock of each variant</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Variant</TableHead>
            <TableHead className="text-right">In stock</TableHead>
            <TableHead>New count</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const nextError = errors.rows?.[index]?.next?.message;
            const noteError = errors.rows?.[index]?.note?.message;
            return (
              <TableRow key={row.variantId} className="align-top">
                <TableCell className="pt-4 font-medium whitespace-normal">{row.label}</TableCell>
                <TableCell className="pt-4 text-right tabular-nums">
                  {expected[row.variantId] ?? row.stock}
                </TableCell>
                <TableCell className="min-w-28 whitespace-normal">
                  <label htmlFor={`stock-${index}-next`} className="sr-only">
                    New count for {row.label}
                  </label>
                  <Input
                    id={`stock-${index}-next`}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={nextError ? true : undefined}
                    aria-describedby={nextError ? `stock-${index}-next-error` : undefined}
                    {...form.register(`rows.${index}.next`)}
                  />
                  {nextError ? (
                    <p
                      id={`stock-${index}-next-error`}
                      role="alert"
                      className="mt-1 text-sm text-destructive"
                    >
                      {nextError}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="min-w-40 whitespace-normal">
                  <label htmlFor={`stock-${index}-note`} className="sr-only">
                    Note for {row.label}
                  </label>
                  <Input
                    id={`stock-${index}-note`}
                    autoComplete="off"
                    maxLength={NOTE_MAX_LENGTH + 50}
                    aria-invalid={noteError ? true : undefined}
                    aria-describedby={noteError ? `stock-${index}-note-error` : undefined}
                    {...form.register(`rows.${index}.note`)}
                  />
                  {noteError ? (
                    <p
                      id={`stock-${index}-note-error`}
                      role="alert"
                      className="mt-1 text-sm text-destructive"
                    >
                      {noteError}
                    </p>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        Type the number you counted, from 0 to {MAX_STOCK}. Rows you leave alone are not saved. A
        note says why, for the history below.
      </p>
      <Button type="submit" className="self-start" disabled={pending || !hydrated}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Save stock
      </Button>
    </form>
  );
}
