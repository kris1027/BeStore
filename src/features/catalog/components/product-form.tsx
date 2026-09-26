"use client";

import { ArrowLeftIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type Control,
  get,
  type FieldErrors,
  type Path,
  useFieldArray,
  useForm,
  type UseFormRegister,
  useWatch,
} from "react-hook-form";

import { useStoreFormat } from "@/components/store-format-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { fractionDigits } from "@/lib/money";
import { slugify } from "@/lib/slug";

import { createProduct } from "../actions/create-product";
import { type NewProductStatus, pathErrors, productFormSchema } from "../schemas";
import {
  combinationCount,
  combinationKey,
  combinations,
  MAX_COMBINATIONS,
  MAX_OPTION_TYPES,
  MAX_OPTION_VALUES,
  suggestSku,
} from "../variant-grid";

const productsPath = "/admin/products";

// Each option value carries a client id, so a variant row is keyed by which values it combines,
// not by their text: renaming a value keeps the price and stock typed in its rows.
type ValueField = { readonly id: string; value: string };
type OptionTypeField = { readonly id: string; name: string; values: ValueField[] };
type VariantField = { readonly key: string; price: string; stock: string; sku: string };

type FormState = {
  name: string;
  slug: string;
  description: string;
  optionTypes: OptionTypeField[];
  variants: VariantField[];
};

const newId = () => crypto.randomUUID();

const defaultVariant = (slug: string): VariantField => ({
  key: combinationKey([]),
  price: "",
  stock: "0",
  sku: suggestSku(slug, []),
});

// The ids an error path points at: "variants.0.price" is the input with id "variants-0-price".
const fieldId = (path: string) => path.replace(/\./g, "-");

// Schema paths name an option value by index ("optionTypes.0.values.1"); the form stores it as
// an object, so its input lives one level down.
function formPath(path: string): string {
  if (/^optionTypes\.\d+\.values\.\d+$/.test(path)) return `${path}.value`;
  if (/^(root|optionTypes|variants|optionTypes\.\d+\.values)$/.test(path)) {
    return `root.${fieldId(path)}`;
  }
  return path;
}

function errorAt(errors: FieldErrors<FormState>, path: string): string | undefined {
  const error: unknown = get(errors, path);
  return typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : undefined;
}

function variantRows(optionTypes: readonly OptionTypeField[]) {
  const text = new Map(optionTypes.flatMap((type) => type.values.map((v) => [v.id, v.value])));
  const count = combinationCount(
    optionTypes.map((type) => ({ name: type.name, values: type.values.map((v) => v.id) })),
  );
  if (count > MAX_COMBINATIONS) return { count, rows: null };
  const rows = combinations(
    optionTypes.map((type) => ({ name: type.name, values: type.values.map((v) => v.id) })),
  ).map((ids) => ({
    key: combinationKey(ids),
    values: ids.map((id) => text.get(id) ?? ""),
  }));
  return { count, rows };
}

export function ProductForm() {
  const router = useRouter();
  const { currency } = useStoreFormat();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<NewProductStatus | null>(null);
  // Suggestions follow the name and values until the admin types their own.
  const slugEdited = useRef(false);
  const editedSkus = useRef(new Set<string>());

  const form = useForm<FormState>({
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      optionTypes: [],
      variants: [defaultVariant("")],
    },
  });
  const { control, register, setValue, getValues, setError, clearErrors, formState } = form;
  const { errors } = formState;

  const optionTypesArray = useFieldArray({ control, name: "optionTypes", keyName: "fieldKey" });
  const variantsArray = useFieldArray({ control, name: "variants", keyName: "fieldKey" });

  const name = useWatch({ control, name: "name" });
  const slug = useWatch({ control, name: "slug" });
  const optionTypes = useWatch({ control, name: "optionTypes" });
  const grid = useMemo(() => variantRows(optionTypes), [optionTypes]);

  useEffect(() => {
    if (!slugEdited.current) setValue("slug", slugify(name));
  }, [name, setValue]);

  // Keeps one row per combination: new combinations get a row, gone ones lose theirs, and
  // every other row keeps what was typed in it.
  const { replace: replaceVariants } = variantsArray;
  useEffect(() => {
    const rows = grid.rows ?? [];
    const current = getValues("variants");
    const byKey = new Map(current.map((row) => [row.key, row]));
    const next = rows.map(
      (row) =>
        byKey.get(row.key) ?? {
          key: row.key,
          price: "",
          stock: "0",
          sku: suggestSku(slug, row.values),
        },
    );
    const sameRows =
      next.length === current.length && next.every((row, i) => row.key === current[i]?.key);
    if (!sameRows) replaceVariants(next);
    rows.forEach((row, i) => {
      if (editedSkus.current.has(row.key)) return;
      const sku = suggestSku(slug, row.values);
      if (getValues(`variants.${i}.sku`) !== sku) setValue(`variants.${i}.sku`, sku);
    });
  }, [grid, slug, getValues, setValue, replaceVariants]);

  function showErrors(fields: Record<string, readonly string[]>) {
    let first = true;
    for (const [path, messages] of Object.entries(fields)) {
      const message = messages[0];
      if (!message) continue;
      const target = formPath(path);
      setError(target as Path<FormState>, { type: "validate", message });
      if (first) {
        document
          .getElementById(target.startsWith("root.") ? target.slice(5) : fieldId(target))
          ?.focus();
        first = false;
      }
    }
  }

  function submit(status: NewProductStatus) {
    setFormError(null);
    clearErrors();
    const state = getValues();
    const labels = variantRows(state.optionTypes).rows ?? [];
    const payload = {
      name: state.name,
      slug: state.slug,
      description: state.description,
      optionTypes: state.optionTypes.map((type) => ({
        name: type.name,
        values: type.values.map((v) => v.value),
      })),
      variants: state.variants.map((variant, i) => ({
        values: labels[i]?.values ?? [],
        price: variant.price,
        stock: variant.stock,
        sku: variant.sku,
      })),
    };

    const parsed = productFormSchema(currency).safeParse(payload);
    if (!parsed.success) {
      showErrors(pathErrors(parsed.error));
      return;
    }

    setSubmitting(status);
    startTransition(async () => {
      const result = await createProduct(payload, status);
      setSubmitting(null);
      if (!result.ok) {
        if (result.error.fields) showErrors(result.error.fields);
        if (result.error.form) setFormError("The product could not be saved. Try again.");
        return;
      }
      toast.add({
        title: status === "active" ? "Product published" : "Draft saved",
        description: state.name.trim(),
        type: "success",
      });
      router.push(productsPath);
    });
  }

  const variantsError = errorAt(errors, "root.variants");
  const optionTypesError = errorAt(errors, "root.optionTypes");
  const digits = fractionDigits(currency);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit("draft");
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-3">
        <Link
          href={productsPath}
          className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Products
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">New product</h1>
          <p className="text-sm text-muted-foreground">
            Fill in the details, then save it as a draft or publish it to the storefront.
          </p>
        </div>
      </div>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Details</h2>
              </CardTitle>
              <CardDescription>What customers see on the product page.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextField register={register} errors={errors} path="name" label="Name" />
                <TextField
                  register={register}
                  errors={errors}
                  path="slug"
                  label="URL name"
                  description={`The product's address: /products/${slug || "your-product"}`}
                  onEdit={() => {
                    slugEdited.current = true;
                  }}
                />
                <Field data-invalid={errors.description ? true : undefined}>
                  <FieldLabel htmlFor="description">Description</FieldLabel>
                  <Textarea
                    id="description"
                    rows={5}
                    aria-invalid={errors.description ? true : undefined}
                    aria-describedby={errors.description ? "description-error" : undefined}
                    {...register("description")}
                  />
                  <FieldError id="description-error" errors={[errors.description]} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Options</h2>
              </CardTitle>
              <CardDescription>
                Sizes, colors and the like. Each combination becomes a variant with its own price
                and stock. Leave this empty for a product that comes in one version.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {optionTypesArray.fields.map((type, t) => (
                <OptionTypeFields
                  key={type.fieldKey}
                  index={t}
                  control={control}
                  register={register}
                  errors={errors}
                  onRemove={() => optionTypesArray.remove(t)}
                />
              ))}
              {optionTypesError ? (
                <p id="optionTypes-error" role="alert" className="text-sm text-destructive">
                  {optionTypesError}
                </p>
              ) : null}
              <p id="optionTypes" tabIndex={-1} className="sr-only">
                Options
              </p>
            </CardContent>
            <CardFooter>
              <Button
                type="button"
                variant="outline"
                disabled={optionTypesArray.fields.length >= MAX_OPTION_TYPES}
                onClick={() =>
                  optionTypesArray.append(
                    { id: newId(), name: "", values: [{ id: newId(), value: "" }] },
                    { focusName: `optionTypes.${optionTypesArray.fields.length}.name` },
                  )
                }
              >
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                Add option
              </Button>
              {optionTypesArray.fields.length >= MAX_OPTION_TYPES ? (
                <span className="ml-3 text-sm text-muted-foreground">
                  Up to {MAX_OPTION_TYPES} options.
                </span>
              ) : null}
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id="variants" tabIndex={-1}>
                  Price and stock
                </h2>
              </CardTitle>
              <CardDescription>
                Prices in {currency}, like {(19.99).toFixed(digits)}. Stock is the number you can
                sell now.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {variantsError ? (
                <p role="alert" className="text-sm text-destructive">
                  {variantsError}
                </p>
              ) : null}
              {grid.rows === null ? (
                <p role="status" className="text-sm text-destructive">
                  These options make {grid.count} variants. The limit is {MAX_COMBINATIONS}, so
                  remove some values.
                </p>
              ) : (
                <VariantsTable
                  rows={grid.rows}
                  fields={variantsArray.fields}
                  register={register}
                  errors={errors}
                  onSkuEdit={(key) => editedSkus.current.add(key)}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>
              <h2>Save</h2>
            </CardTitle>
            <CardDescription>
              A draft stays hidden. Publishing puts the product on the storefront right away.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col items-stretch gap-2">
            <Button type="button" size="lg" disabled={pending} onClick={() => submit("active")}>
              {submitting === "active" ? <Spinner data-icon="inline-start" /> : null}
              Publish
            </Button>
            <Button type="submit" size="lg" variant="outline" disabled={pending}>
              {submitting === "draft" ? <Spinner data-icon="inline-start" /> : null}
              Save as draft
            </Button>
          </CardFooter>
        </Card>
      </div>
    </form>
  );
}

function TextField({
  register,
  errors,
  path,
  label,
  description,
  onEdit,
}: {
  readonly register: UseFormRegister<FormState>;
  readonly errors: FieldErrors<FormState>;
  readonly path: "name" | "slug";
  readonly label: string;
  readonly description?: string;
  readonly onEdit?: () => void;
}) {
  const error = errorAt(errors, path);
  const describedBy = [description ? `${path}-description` : null, error ? `${path}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={path}>{label}</FieldLabel>
      <Input
        id={path}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...register(path, { onChange: onEdit })}
      />
      {description ? (
        <FieldDescription id={`${path}-description`}>{description}</FieldDescription>
      ) : null}
      <FieldError id={`${path}-error`}>{error}</FieldError>
    </Field>
  );
}

function OptionTypeFields({
  index,
  control,
  register,
  errors,
  onRemove,
}: {
  readonly index: number;
  readonly control: Control<FormState>;
  readonly register: UseFormRegister<FormState>;
  readonly errors: FieldErrors<FormState>;
  readonly onRemove: () => void;
}) {
  const values = useFieldArray({
    control,
    name: `optionTypes.${index}.values`,
    keyName: "fieldKey",
  });
  const typeName = useWatch({ control, name: `optionTypes.${index}.name` });
  const label = typeName.trim() || `Option ${index + 1}`;
  const namePath = `optionTypes.${index}.name` as const;
  const nameError = errorAt(errors, namePath);
  const valuesError = errorAt(errors, `root.optionTypes-${index}-values`);

  return (
    <FieldSet className="gap-4 rounded-md border p-4">
      <div className="flex items-start justify-between gap-2">
        <FieldLegend className="mb-0">{label}</FieldLegend>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <XIcon data-icon="inline-start" aria-hidden="true" />
          Remove<span className="sr-only"> {label}</span>
        </Button>
      </div>
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor={fieldId(namePath)}>Option name</FieldLabel>
        <Input
          id={fieldId(namePath)}
          placeholder="Size"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${fieldId(namePath)}-error` : undefined}
          {...register(namePath)}
        />
        <FieldError id={`${fieldId(namePath)}-error`}>{nameError}</FieldError>
      </Field>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id={`optionTypes-${index}-values`} tabIndex={-1}>
          Values
        </p>
        <ul className="flex flex-col gap-2">
          {values.fields.map((value, v) => {
            const path = `optionTypes.${index}.values.${v}.value` as const;
            const id = fieldId(`optionTypes.${index}.values.${v}`);
            const error = errorAt(errors, path);
            return (
              <li key={value.fieldKey} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <label htmlFor={id} className="sr-only">
                    {label} value {v + 1}
                  </label>
                  <Input
                    id={id}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    {...register(path)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={values.fields.length === 1}
                    aria-label={`Remove ${label} value ${v + 1}`}
                    onClick={() => values.remove(v)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
                {error ? (
                  <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {valuesError ? (
          <p role="alert" className="text-sm text-destructive">
            {valuesError}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={values.fields.length >= MAX_OPTION_VALUES}
          onClick={() =>
            values.append(
              { id: newId(), value: "" },
              { focusName: `optionTypes.${index}.values.${values.fields.length}.value` },
            )
          }
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add value<span className="sr-only"> to {label}</span>
        </Button>
      </div>
    </FieldSet>
  );
}

function VariantsTable({
  rows,
  fields,
  register,
  errors,
  onSkuEdit,
}: {
  readonly rows: readonly { readonly key: string; readonly values: readonly string[] }[];
  readonly fields: readonly { readonly fieldKey: string; readonly key: string }[];
  readonly register: UseFormRegister<FormState>;
  readonly errors: FieldErrors<FormState>;
  readonly onSkuEdit: (key: string) => void;
}) {
  const hasOptions = (rows[0]?.values.length ?? 0) > 0;
  return (
    <Table>
      <TableCaption className="sr-only">Price, stock and SKU of each variant</TableCaption>
      <TableHeader>
        <TableRow>
          {hasOptions ? <TableHead>Variant</TableHead> : null}
          <TableHead>Price</TableHead>
          <TableHead>Stock</TableHead>
          <TableHead>SKU</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map((field, i) => {
          const values = rows.find((row) => row.key === field.key)?.values ?? [];
          const label = values.length > 0 ? values.join(" / ") : "the product";
          return (
            <TableRow key={field.fieldKey} className="align-top">
              {hasOptions ? (
                <TableCell className="pt-4 font-medium whitespace-normal">
                  {values.join(" / ")}
                </TableCell>
              ) : null}
              {(["price", "stock", "sku"] as const).map((column) => {
                const path = `variants.${i}.${column}` as const;
                const id = fieldId(path);
                const error = errorAt(errors, path);
                const columnLabel = { price: "Price", stock: "Stock", sku: "SKU" }[column];
                return (
                  <TableCell key={column} className="min-w-28 whitespace-normal">
                    <label htmlFor={id} className="sr-only">
                      {columnLabel} for {label}
                    </label>
                    <Input
                      id={id}
                      inputMode={
                        column === "sku" ? undefined : column === "price" ? "decimal" : "numeric"
                      }
                      autoCapitalize={column === "sku" ? "characters" : undefined}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                      {...register(path, {
                        onChange: column === "sku" ? () => onSkuEdit(field.key) : undefined,
                      })}
                    />
                    {error ? (
                      <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-destructive">
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
  );
}
