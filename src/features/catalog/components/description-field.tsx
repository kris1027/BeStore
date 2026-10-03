"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

import { ProductDescription } from "../markdown";
import { DESCRIPTION_MAX_LENGTH } from "../schemas";

// spec 0009, AC-6: the description in Markdown, with a Write and Preview toggle. The textarea
// stays mounted (only hidden) in Preview, so the form keeps its registration and value.
export function DescriptionField({
  id,
  value,
  error,
  textarea,
}: {
  readonly id: string;
  readonly value: string;
  readonly error: string | undefined;
  // The registered textarea props, owned by the form.
  readonly textarea: React.ComponentProps<"textarea">;
}) {
  const [preview, setPreview] = useState(false);
  const describedBy = [`${id}-description`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <Field data-invalid={error ? true : undefined}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FieldLabel htmlFor={id}>Description</FieldLabel>
        <div
          role="group"
          aria-label="Write or preview"
          className="flex gap-1 rounded-md border p-0.5"
        >
          <Button
            type="button"
            size="sm"
            variant={preview ? "ghost" : "secondary"}
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            Write
          </Button>
          <Button
            type="button"
            size="sm"
            variant={preview ? "secondary" : "ghost"}
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            Preview
          </Button>
        </div>
      </div>
      <Textarea
        id={id}
        rows={8}
        hidden={preview}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...textarea}
      />
      {preview ? (
        <section
          aria-label="Description preview"
          className="min-h-32 rounded-md border bg-muted/30 p-3 text-sm"
        >
          {value.trim() ? (
            <ProductDescription markdown={value} />
          ) : (
            <p className="text-muted-foreground">Nothing to preview yet.</p>
          )}
        </section>
      ) : null}
      <FieldDescription id={`${id}-description`}>
        Markdown: **bold**, *italic*, lists, ## headings and [links](https://example.com). Leave a
        blank line between paragraphs. {value.length} of {DESCRIPTION_MAX_LENGTH} characters.
      </FieldDescription>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
