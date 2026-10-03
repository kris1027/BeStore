"use client";

import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type FieldErrors, get, type Path, useForm, useWatch } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { useStoreFormat } from "@/components/store-format-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
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
import { centsToInput, fractionDigits } from "@/lib/money";
import { useHydrated } from "@/hooks/use-hydrated";

import type { EditOptionType, EditVariant } from "../../admin-queries";
import { updateVariants } from "../../actions/update-variants";
import { pathErrors, variantsSchema } from "../../schemas";
import type { ProductStatus } from "../../status";
import { AddValueDialog } from "./add-value-dialog";
import { notFoundMessage, staleMessage } from "./messages";

type RowField = {
  price: string;
  compareAt: string;
  sku: string;
  archived: boolean;
};

type FormState = {
  optionNames: { name: string; values: { value: string }[] }[];
  rows: RowField[];
};

const lastVariantMessage =
  "Hide or archive the product instead. A live product needs at least one variant.";

// The id of the input an error path points at: "rows.0.price" is "variants-rows-0-price".
const inputId = (path: string) => `variants-${path.replace(/\./g, "-")}`;

function errorAt(errors: FieldErrors<FormState>, path: string): string | undefined {
  const error: unknown = get(errors, path);
  return typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : undefined;
}

// spec 0009, AC-7 to AC-9: option names, and each variant's price, compare at price, SKU and
// archive flag. Option types are fixed after create; values can be renamed or added.
export function VariantsForm({
  productId,
  slug,
  status,
  optionTypes,
  variants,
}: {
  readonly productId: string;
  readonly slug: string;
  readonly status: ProductStatus;
  readonly optionTypes: readonly EditOptionType[];
  readonly variants: readonly EditVariant[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const { currency } = useStoreFormat();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const form = useForm<FormState>({
    defaultValues: {
      optionNames: optionTypes.map((type) => ({
        name: type.name,
        values: type.values.map((value) => ({ value: value.value })),
      })),
      rows: variants.map((variant) => ({
        price: centsToInput(variant.priceCents, currency),
        compareAt:
          variant.compareAtPriceCents === null
            ? ""
            : centsToInput(variant.compareAtPriceCents, currency),
        sku: variant.sku,
        archived: variant.archived,
      })),
    },
  });
  const { errors } = form.formState;
  const archivedFlags = useWatch({ control: form.control, name: "rows" }).map(
    (row) => row.archived,
  );

  function showErrors(fields: Record<string, readonly string[]>) {
    let first = true;
    for (const [path, messages] of Object.entries(fields)) {
      if (!/^(rows|optionNames)\.\d+\./.test(path)) continue;
      form.setError(path as Path<FormState>, { type: "validate", message: messages[0] });
      if (first) {
        document.getElementById(inputId(path))?.focus();
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
      rows: variants.map((variant, index) => ({
        variantId: variant.id,
        loaded: {
          price: variant.priceCents,
          compareAt: variant.compareAtPriceCents,
          sku: variant.sku,
          archived: variant.archived,
        },
        ...state.rows[index],
      })),
      optionNames: optionTypes.map((type, t) => ({
        typeId: type.id,
        loadedName: type.name,
        name: state.optionNames[t]?.name ?? type.name,
        values: type.values.map((value, v) => ({
          valueId: value.id,
          loadedValue: value.value,
          value: state.optionNames[t]?.values[v]?.value ?? value.value,
        })),
      })),
    };
    const parsed = variantsSchema(currency).safeParse(payload);
    if (!parsed.success) {
      showErrors(pathErrors(parsed.error));
      return;
    }

    startTransition(async () => {
      const result = await updateVariants(payload);
      if (result.ok) {
        toast.add({ title: "Variants saved", type: "success" });
        router.refresh();
        return;
      }
      switch (result.error.code) {
        case "validation":
        case "sku_taken":
          showErrors(result.error.fields);
          return;
        case "last_variant":
          setNotice(lastVariantMessage);
          return;
        case "rename_swap":
          setNotice("Rename one at a time. Save one name, then the other.");
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

  const digits = fractionDigits(currency);
  const hasOptions = optionTypes.length > 0;

  return (
    <form
      noValidate
      aria-label="Variants"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-6"
    >
      <FormNotice message={notice} />

      {hasOptions ? (
        <div className="flex flex-col gap-4">
          {optionTypes.map((type, t) => (
            <FieldSet key={type.id} className="gap-4 rounded-md border p-4">
              <FieldLegend className="mb-0">{type.name}</FieldLegend>
              <Field data-invalid={errorAt(errors, `optionNames.${t}.name`) ? true : undefined}>
                <FieldLabel htmlFor={inputId(`optionNames.${t}.name`)}>Option name</FieldLabel>
                <Input
                  id={inputId(`optionNames.${t}.name`)}
                  aria-invalid={errorAt(errors, `optionNames.${t}.name`) ? true : undefined}
                  aria-describedby={
                    errorAt(errors, `optionNames.${t}.name`)
                      ? `${inputId(`optionNames.${t}.name`)}-error`
                      : undefined
                  }
                  {...form.register(`optionNames.${t}.name`)}
                />
                <FieldError id={`${inputId(`optionNames.${t}.name`)}-error`}>
                  {errorAt(errors, `optionNames.${t}.name`)}
                </FieldError>
              </Field>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Values</p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {type.values.map((value, v) => {
                    const path = `optionNames.${t}.values.${v}.value` as const;
                    const error = errorAt(errors, path);
                    return (
                      <li key={value.id} className="flex flex-col gap-1">
                        <label htmlFor={inputId(path)} className="sr-only">
                          {type.name} value {v + 1}
                        </label>
                        <Input
                          id={inputId(path)}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${inputId(path)}-error` : undefined}
                          {...form.register(path)}
                        />
                        {error ? (
                          <p
                            id={`${inputId(path)}-error`}
                            role="alert"
                            className="text-sm text-destructive"
                          >
                            {error}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <AddValueDialog
                productId={productId}
                slug={slug}
                typeIndex={t}
                optionTypes={optionTypes}
                variantCount={variants.length}
              />
            </FieldSet>
          ))}
          <p className="text-sm text-muted-foreground">
            Options cannot be added or removed after create. Values are never removed: archive a
            variant instead.
          </p>
        </div>
      ) : null}

      <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Variant prices" }}>
        <TableCaption className="sr-only">
          Price, compare at price, SKU and status of each variant. Prices in {currency}, like{" "}
          {(19.99).toFixed(digits)}.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Variant</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Compare at</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((variant, index) => {
            const archived = archivedFlags[index] ?? variant.archived;
            const changed = archived !== variant.archived;
            return (
              <TableRow key={variant.id} className="align-top">
                <TableCell className="pt-4 font-medium whitespace-normal">
                  {variant.label}
                </TableCell>
                {(["price", "compareAt", "sku"] as const).map((column) => {
                  const path = `rows.${index}.${column}` as const;
                  const error = errorAt(errors, path);
                  const columnLabel = {
                    price: "Price",
                    compareAt: "Compare at price",
                    sku: "SKU",
                  }[column];
                  return (
                    <TableCell key={column} className="min-w-28 whitespace-normal">
                      <label htmlFor={inputId(path)} className="sr-only">
                        {columnLabel} for {variant.label}
                      </label>
                      <Input
                        id={inputId(path)}
                        inputMode={column === "sku" ? undefined : "decimal"}
                        autoCapitalize={column === "sku" ? "characters" : undefined}
                        autoComplete="off"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${inputId(path)}-error` : undefined}
                        {...form.register(path)}
                      />
                      {error ? (
                        <p
                          id={`${inputId(path)}-error`}
                          role="alert"
                          className="mt-1 text-sm text-destructive"
                        >
                          {error}
                        </p>
                      ) : null}
                    </TableCell>
                  );
                })}
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col items-start gap-2">
                    <Badge variant={archived ? "outline" : "secondary"}>
                      {archived ? "Archived" : "Active"}
                      {changed ? <span className="font-normal"> (not saved)</span> : null}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        form.setValue(`rows.${index}.archived`, !archived, { shouldDirty: true })
                      }
                    >
                      {archived ? (
                        <ArchiveRestoreIcon data-icon="inline-start" aria-hidden="true" />
                      ) : (
                        <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
                      )}
                      {archived ? "Restore" : "Archive"}
                      <span className="sr-only"> {variant.label}</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        A compare at price shows struck through next to the price, as a sale. Leave it empty for
        none. {status === "active" ? "A live product keeps at least one active variant." : null}
      </p>
      <Button type="submit" className="self-start" disabled={pending || !hydrated}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Save variants
      </Button>
    </form>
  );
}
