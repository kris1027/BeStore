"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";

import { FormNotice } from "@/components/form-notice";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { updateProductDetails } from "../../actions/update-details";
import { detailsSchema, MAX_WEIGHT_GRAMS } from "../../schemas";
import type { ProductStatus } from "../../status";
import { notFoundMessage, staleMessage } from "./messages";

const formSchema = detailsSchema.pick({
  name: true,
  slug: true,
  description: true,
  featured: true,
  weightGrams: true,
});

type DetailsValues = z.input<typeof formSchema>;

const fields = ["name", "slug", "description", "featured", "weightGrams"] as const;

// spec 0009, AC-5: name, URL name, description, featured and weight. The parent keys this form
// by the product's updated_at, so a save that lands remounts it with the stored values.
export function DetailsForm({
  product,
}: {
  readonly product: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly featured: boolean;
    readonly weightGrams: number | null;
    readonly status: ProductStatus;
    readonly updatedAt: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const form = useForm<DetailsValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: product.name,
      slug: product.slug,
      description: product.description,
      featured: product.featured,
      weightGrams: product.weightGrams === null ? "" : String(product.weightGrams),
    },
  });
  const { errors } = form.formState;
  const slug = useWatch({ control: form.control, name: "slug" });
  const slugChanged = product.status === "active" && slug.trim() !== product.slug;

  // The server parses the raw strings itself, so the form sends what was typed.
  const onSubmit = form.handleSubmit(() => {
    setNotice(null);
    const values = form.getValues();
    startTransition(async () => {
      const result = await updateProductDetails({
        ...values,
        productId: product.id,
        loadedUpdatedAt: product.updatedAt,
      });
      if (result.ok) {
        toast.add({ title: "Details saved", type: "success" });
        router.refresh();
        return;
      }
      switch (result.error.code) {
        case "validation": {
          const { fields: serverFields } = result.error;
          fields
            .filter((field) => serverFields[field]?.[0] !== undefined)
            .forEach((field, index) => {
              form.setError(
                field,
                { type: "server", message: serverFields[field]?.[0] },
                { shouldFocus: index === 0 },
              );
            });
          return;
        }
        case "slug_taken":
          form.setError(
            "slug",
            { type: "server", message: "Another product already uses this URL name." },
            { shouldFocus: true },
          );
          return;
        case "stale":
          setNotice(staleMessage);
          return;
        case "not_found":
          setNotice(notFoundMessage);
          return;
      }
    });
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate aria-labelledby="details-heading">
        <CardHeader>
          <CardTitle>
            <h2 id="details-heading">Details</h2>
          </CardTitle>
          <CardDescription>What customers see on the product page.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FormNotice message={notice} />
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="details-name">Name</FieldLabel>
              <Input
                id="details-name"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "details-name-error" : undefined}
                {...form.register("name")}
              />
              <FieldError id="details-name-error" errors={[errors.name]} />
            </Field>
            <Field data-invalid={errors.slug ? true : undefined}>
              <FieldLabel htmlFor="details-slug">URL name</FieldLabel>
              <Input
                id="details-slug"
                autoCapitalize="none"
                aria-invalid={errors.slug ? true : undefined}
                aria-describedby={
                  [
                    "details-slug-description",
                    slugChanged ? "details-slug-warning" : null,
                    errors.slug ? "details-slug-error" : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                {...form.register("slug")}
              />
              <FieldDescription id="details-slug-description">
                The product&apos;s address: /products/{slug.trim() || "your-product"}
              </FieldDescription>
              {slugChanged ? (
                <Alert id="details-slug-warning">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertDescription>
                    This product is live. Links to /products/{product.slug} stop working once you
                    save.
                  </AlertDescription>
                </Alert>
              ) : null}
              <FieldError id="details-slug-error" errors={[errors.slug]} />
            </Field>
            <Field data-invalid={errors.description ? true : undefined}>
              <FieldLabel htmlFor="details-description">Description</FieldLabel>
              <Textarea
                id="details-description"
                rows={8}
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={errors.description ? "details-description-error" : undefined}
                {...form.register("description")}
              />
              <FieldError id="details-description-error" errors={[errors.description]} />
            </Field>
            <Field data-invalid={errors.weightGrams ? true : undefined}>
              <FieldLabel htmlFor="details-weight">Weight in grams</FieldLabel>
              <Input
                id="details-weight"
                inputMode="numeric"
                autoComplete="off"
                className="max-w-48"
                aria-invalid={errors.weightGrams ? true : undefined}
                aria-describedby={
                  errors.weightGrams ? "details-weight-error" : "details-weight-description"
                }
                {...form.register("weightGrams")}
              />
              {errors.weightGrams ? (
                <FieldError id="details-weight-error" errors={[errors.weightGrams]} />
              ) : (
                <FieldDescription id="details-weight-description">
                  Optional, from 1 to {MAX_WEIGHT_GRAMS}.
                </FieldDescription>
              )}
            </Field>
            <Field orientation="horizontal">
              <Controller
                control={form.control}
                name="featured"
                render={({ field }) => (
                  <Checkbox
                    id="details-featured"
                    name={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    aria-describedby="details-featured-description"
                  />
                )}
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="details-featured">Featured</FieldLabel>
                <FieldDescription id="details-featured-description">
                  Marks the product for the Featured tab.
                </FieldDescription>
              </div>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save details
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
