"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";
import { slugify } from "@/lib/slug";

import { type CategoryFormError, createCategory } from "../actions/create-category";
import { updateCategory } from "../actions/update-category";
import { adminCategoryPath } from "../paths";
import { CATEGORY_DESCRIPTION_MAX_LENGTH, categoryFieldsSchema } from "../schemas";

type Values = z.input<typeof categoryFieldsSchema>;

const fields = ["name", "slug", "description", "visible"] as const;

const messages = {
  stale: "This category changed since you opened it. Reload to see the latest.",
  not_found: "This category no longer exists. Go back to the categories.",
} as const;

// spec 0009, AC-17: name, URL name (suggested from the name on create), description and
// visible. On edit, keyed by updated_at so a save that lands remounts it with stored values.
export function CategoryForm({
  category,
}: {
  readonly category?: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string | null;
    readonly visible: boolean;
    readonly updatedAt: string;
  };
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  // The URL name follows the name until the admin types their own (always, once saved).
  const [slugEdited, setSlugEdited] = useState(category !== undefined);
  const form = useForm<Values, unknown, z.output<typeof categoryFieldsSchema>>({
    resolver: zodResolver(categoryFieldsSchema),
    defaultValues: {
      name: category?.name ?? "",
      slug: category?.slug ?? "",
      description: category?.description ?? "",
      visible: category?.visible ?? true,
    },
  });
  const { errors } = form.formState;
  const name = useWatch({ control: form.control, name: "name" });
  const { setValue } = form;

  useEffect(() => {
    if (!slugEdited) setValue("slug", slugify(name));
  }, [name, slugEdited, setValue]);

  function showError(error: CategoryFormError) {
    switch (error.code) {
      case "validation":
        fields
          .filter((field) => error.fields[field] !== undefined)
          .forEach((field, index) => {
            form.setError(
              field,
              { type: "server", message: error.fields[field] },
              { shouldFocus: index === 0 },
            );
          });
        return;
      case "slug_taken":
        form.setError(
          "slug",
          { type: "server", message: "Another category already uses this URL name." },
          { shouldFocus: true },
        );
        return;
      default:
        setNotice(messages[error.code]);
    }
  }

  const onSubmit = form.handleSubmit(() => {
    setNotice(null);
    const values = form.getValues();
    startTransition(async () => {
      if (category === undefined) {
        const result = await createCategory(values);
        if (!result.ok) return showError(result.error);
        toast.add({ title: "Category added", description: values.name.trim(), type: "success" });
        router.push(adminCategoryPath(result.data.categoryId));
        return;
      }
      const result = await updateCategory({
        ...values,
        categoryId: category.id,
        loadedUpdatedAt: category.updatedAt,
      });
      if (!result.ok) return showError(result.error);
      toast.add({ title: "Category saved", type: "success" });
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Category" className="flex flex-col gap-6">
      <FieldGroup>
        <FormNotice message={notice} />
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="category-name">Name</FieldLabel>
          <Input
            id="category-name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "category-name-error" : undefined}
            {...form.register("name")}
          />
          <FieldError id="category-name-error" errors={[errors.name]} />
        </Field>
        <Field data-invalid={errors.slug ? true : undefined}>
          <FieldLabel htmlFor="category-slug">URL name</FieldLabel>
          <Input
            id="category-slug"
            autoCapitalize="none"
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={
              errors.slug
                ? "category-slug-description category-slug-error"
                : "category-slug-description"
            }
            {...form.register("slug", {
              onChange: () => setSlugEdited(true),
            })}
          />
          <FieldDescription id="category-slug-description">
            Lowercase letters and digits joined by hyphens, like summer-linen.
          </FieldDescription>
          <FieldError id="category-slug-error" errors={[errors.slug]} />
        </Field>
        <Field data-invalid={errors.description ? true : undefined}>
          <FieldLabel htmlFor="category-description">Description</FieldLabel>
          <Textarea
            id="category-description"
            rows={4}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={
              errors.description
                ? "category-description-hint category-description-error"
                : "category-description-hint"
            }
            {...form.register("description")}
          />
          <FieldDescription id="category-description-hint">
            Optional plain text, up to {CATEGORY_DESCRIPTION_MAX_LENGTH} characters.
          </FieldDescription>
          <FieldError id="category-description-error" errors={[errors.description]} />
        </Field>
        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="visible"
            render={({ field }) => (
              <Checkbox
                id="category-visible"
                name={field.name}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                aria-describedby="category-visible-description"
              />
            )}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="category-visible">Visible</FieldLabel>
            <FieldDescription id="category-visible-description">
              Shoppers will see visible categories once the storefront lists them.
            </FieldDescription>
          </div>
        </Field>
      </FieldGroup>
      <Button type="submit" className="self-start" disabled={pending || !hydrated}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {category === undefined ? "Add category" : "Save category"}
      </Button>
    </form>
  );
}
