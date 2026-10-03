"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { type FieldErrors, get, type Path, useForm, useWatch } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { useStoreFormat } from "@/components/store-format-provider";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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

import type { EditOptionType } from "../../admin-queries";
import { addOptionValue } from "../../actions/add-option-value";
import { addOptionValueSchema, pathErrors } from "../../schemas";
import { newValueCombinations } from "../../variant-edit";
import { MAX_COMBINATIONS, MAX_OPTION_VALUES, suggestSku } from "../../variant-grid";
import { notFoundMessage, staleMessage } from "./messages";

type NewRow = { price: string; compareAt: string; stock: string; sku: string };
type FormState = { value: string; rows: NewRow[] };

const inputId = (typeIndex: number, path: string) =>
  `add-value-${typeIndex}-${path.replace(/\./g, "-")}`;

function errorAt(errors: FieldErrors<FormState>, path: string): string | undefined {
  const error: unknown = get(errors, path);
  return typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : undefined;
}

// spec 0009, AC-8: a new value goes last in its option type, with one new variant per new
// combination; existing variants keep their values.
export function AddValueDialog({
  productId,
  slug,
  typeIndex,
  optionTypes,
  variantCount,
}: {
  readonly productId: string;
  readonly slug: string;
  readonly typeIndex: number;
  readonly optionTypes: readonly EditOptionType[];
  // Every variant, archived ones included: they count toward the limit.
  readonly variantCount: number;
}) {
  const type = optionTypes[typeIndex];
  const router = useRouter();
  const hydrated = useHydrated();
  const { currency } = useStoreFormat();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [editedSkus, setEditedSkus] = useState<ReadonlySet<number>>(() => new Set());

  // The other option types' values of each new row, as ids (sent) and text (shown).
  const combos = useMemo(
    () =>
      newValueCombinations(
        optionTypes.map((entry) => entry.values.map((value) => value.id)),
        typeIndex,
      ),
    [optionTypes, typeIndex],
  );
  const textOf = useMemo(
    () =>
      new Map(optionTypes.flatMap((entry) => entry.values.map((v) => [v.id, v.value] as const))),
    [optionTypes],
  );

  const form = useForm<FormState>({
    defaultValues: {
      value: "",
      rows: combos.map(() => ({ price: "", compareAt: "", stock: "0", sku: "" })),
    },
  });
  const { errors } = form.formState;
  const newValue = useWatch({ control: form.control, name: "value" });

  if (!type) return null;
  const typeName = type.name;
  const full = type.values.length >= MAX_OPTION_VALUES;
  const overLimit = variantCount + combos.length > MAX_COMBINATIONS;

  function rowValues(others: readonly string[], value: string): string[] {
    const texts = others.map((id) => textOf.get(id) ?? "");
    return [...texts.slice(0, typeIndex), value, ...texts.slice(typeIndex)];
  }

  function rowLabel(others: readonly string[]): string {
    return rowValues(others, newValue.trim() || `new ${typeName}`).join(" / ");
  }

  // SKUs follow the value as it is typed, until the admin edits one.
  function suggestSkus(value: string) {
    combos.forEach((others, index) => {
      if (editedSkus.has(index)) return;
      form.setValue(
        `rows.${index}.sku`,
        value.trim() ? suggestSku(slug, rowValues(others, value.trim())) : "",
      );
    });
  }

  function showErrors(fields: Record<string, readonly string[]>) {
    let first = true;
    for (const [path, messages] of Object.entries(fields)) {
      const target = path.replace(/^newVariants\./, "rows.");
      if (target !== "value" && !/^rows\.\d+\.(price|compareAt|stock|sku)$/.test(target)) continue;
      form.setError(target as Path<FormState>, { type: "validate", message: messages[0] });
      if (first) {
        document.getElementById(inputId(typeIndex, target))?.focus();
        first = false;
      }
    }
  }

  function submit() {
    setNotice(null);
    form.clearErrors();
    const state = form.getValues();
    const payload = {
      productId,
      optionTypeId: type?.id,
      value: state.value,
      newVariants: combos.map((others, index) => ({
        otherValueIds: others,
        ...state.rows[index],
      })),
    };
    const parsed = addOptionValueSchema(currency).safeParse(payload);
    if (!parsed.success) {
      showErrors(pathErrors(parsed.error));
      return;
    }
    startTransition(async () => {
      const result = await addOptionValue(payload);
      if (result.ok) {
        toast.add({
          title: `${typeName} value added`,
          description: state.value.trim(),
          type: "success",
        });
        setOpen(false);
        router.refresh();
        return;
      }
      switch (result.error.code) {
        case "validation":
        case "sku_taken":
          showErrors(result.error.fields);
          return;
        case "too_many_values":
          setNotice(`${typeName} already has ${MAX_OPTION_VALUES} values.`);
          return;
        case "too_many_variants":
          setNotice(`This would make more than ${MAX_COMBINATIONS} variants.`);
          return;
        case "stale":
          setNotice(staleMessage);
          return;
        case "not_found":
          setNotice(notFoundMessage);
          return;
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setNotice(null);
            setEditedSkus(new Set());
            form.reset();
          }
        }}
      >
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={full || overLimit || !hydrated}
            />
          }
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add value<span className="sr-only"> to {typeName}</span>
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
          <form
            noValidate
            className="flex min-w-0 flex-col gap-6"
            onSubmit={(event) => {
              // The dialog renders in a portal but sits inside the Variants form in React's tree.
              event.preventDefault();
              event.stopPropagation();
              submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a value to {typeName}</DialogTitle>
              <DialogDescription>
                It goes last in {typeName}, with a new variant for each combination below. Save
                other changes to the variants first: adding a value reloads them.
              </DialogDescription>
            </DialogHeader>
            <FormNotice message={notice} />
            <Field data-invalid={errorAt(errors, "value") ? true : undefined}>
              <FieldLabel htmlFor={inputId(typeIndex, "value")}>New {typeName} value</FieldLabel>
              <Input
                id={inputId(typeIndex, "value")}
                autoComplete="off"
                aria-invalid={errorAt(errors, "value") ? true : undefined}
                aria-describedby={
                  errorAt(errors, "value") ? `${inputId(typeIndex, "value")}-error` : undefined
                }
                {...form.register("value", {
                  onChange: (event) => suggestSkus(event.target.value),
                })}
              />
              <FieldError id={`${inputId(typeIndex, "value")}-error`}>
                {errorAt(errors, "value")}
              </FieldError>
            </Field>
            <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "New variants" }}>
              <TableCaption className="sr-only">The new variants</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Compare at</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>SKU</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {combos.map((others, index) => {
                  const label = rowLabel(others);
                  return (
                    <TableRow key={others.join(",") || "only"} className="align-top">
                      <TableCell className="pt-4 font-medium whitespace-normal">{label}</TableCell>
                      {(["price", "compareAt", "stock", "sku"] as const).map((column) => {
                        const path = `rows.${index}.${column}` as const;
                        const id = inputId(typeIndex, path);
                        const error = errorAt(errors, path);
                        const columnLabel = {
                          price: "Price",
                          compareAt: "Compare at price",
                          stock: "Stock",
                          sku: "SKU",
                        }[column];
                        return (
                          <TableCell key={column} className="min-w-24 whitespace-normal">
                            <label htmlFor={id} className="sr-only">
                              {columnLabel} for {label}
                            </label>
                            <Input
                              id={id}
                              autoComplete="off"
                              inputMode={
                                column === "sku"
                                  ? undefined
                                  : column === "stock"
                                    ? "numeric"
                                    : "decimal"
                              }
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? `${id}-error` : undefined}
                              {...form.register(path, {
                                onChange:
                                  column === "sku"
                                    ? () => setEditedSkus((set) => new Set(set).add(index))
                                    : undefined,
                              })}
                            />
                            {error ? (
                              <p
                                id={`${id}-error`}
                                role="alert"
                                className="mt-1 text-sm text-destructive"
                              >
                                {error}
                              </p>
                            ) : null}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Add value
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {full ? (
        <span className="text-sm text-muted-foreground">
          {typeName} has the most values it can hold ({MAX_OPTION_VALUES}).
        </span>
      ) : overLimit ? (
        <span className="text-sm text-muted-foreground">
          Another value would make more than {MAX_COMBINATIONS} variants.
        </span>
      ) : null}
    </div>
  );
}
