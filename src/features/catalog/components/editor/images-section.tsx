"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";

import type { EditImage, EditOptionType } from "../../admin-queries";
import { updateProductImages } from "../../actions/update-images";
import { imagesSchema, pathErrors } from "../../schemas";
import type { StorageTarget } from "../image-upload";
import { type ImageDraft, ImagesEditor, type OptionChoice } from "../images-editor";
import { notFoundMessage, staleMessage } from "./messages";

function firstMessages(fields: Record<string, readonly string[]>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([path, messages]) =>
      messages[0] === undefined ? [] : [[path, messages[0]]],
    ),
  );
}

// The element an error path points at, for focus: alt text and option fields, else the image.
function focusTarget(path: string): string | null {
  const match = /^images\.(\d+)(?:\.(altText|optionValueId))?$/.exec(path);
  if (!match) return null;
  const base = `images-${match[1]}`;
  if (match[2] === "altText") return `${base}-alt`;
  if (match[2] === "optionValueId") return `${base}-option`;
  return `${base}-alt`;
}

// spec 0009, AC-13, AC-14 and AC-21: the product's images, saved as one ordered list.
export function ImagesSection({
  productId,
  storage,
  images,
  optionTypes,
}: {
  readonly productId: string;
  readonly storage: StorageTarget;
  readonly images: readonly EditImage[];
  readonly optionTypes: readonly EditOptionType[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [drafts, setDrafts] = useState<readonly ImageDraft[]>(() =>
    images.map((image) => ({
      key: image.id,
      id: image.id,
      path: null,
      src: image.src,
      width: image.width,
      height: image.height,
      altText: image.altText,
      optionKey: image.optionValueId ?? "",
    })),
  );
  const choices: OptionChoice[] = optionTypes.flatMap((type) =>
    type.values.map((value) => ({ key: value.id, label: `${type.name} / ${value.value}` })),
  );

  function showErrors(fields: Record<string, readonly string[]>) {
    const messages = firstMessages(fields);
    setErrors(messages);
    const first = Object.keys(messages)
      .map(focusTarget)
      .find((id) => id !== null);
    if (first) document.getElementById(first)?.focus();
  }

  function save() {
    setNotice(null);
    setErrors({});
    const payload = {
      productId,
      loaded: images.map((image) => ({
        id: image.id,
        altText: image.altText,
        position: image.position,
        optionValueId: image.optionValueId,
      })),
      images: drafts.map((draft) => {
        const optionValueId = draft.optionKey === "" ? null : draft.optionKey;
        return draft.id !== null
          ? { id: draft.id, altText: draft.altText, optionValueId }
          : {
              path: draft.path ?? undefined,
              altText: draft.altText,
              width: draft.width ?? undefined,
              height: draft.height ?? undefined,
              optionValueId,
            };
      }),
    };
    const parsed = imagesSchema.safeParse(payload);
    if (!parsed.success) {
      showErrors(pathErrors(parsed.error));
      return;
    }
    startTransition(async () => {
      const result = await updateProductImages(payload);
      if (result.ok) {
        toast.add({ title: "Images saved", type: "success" });
        router.refresh();
        return;
      }
      switch (result.error.code) {
        case "validation":
          showErrors(result.error.fields);
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
    <div className="flex flex-col gap-4">
      <FormNotice message={notice} />
      <ImagesEditor
        idPrefix="images"
        storage={storage}
        images={drafts}
        onChange={(next) => {
          setDrafts(next);
          setErrors({});
        }}
        choices={choices}
        errors={errors}
        disabled={pending}
      />
      <Button type="button" className="self-start" disabled={pending || !hydrated} onClick={save}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Save images
      </Button>
    </div>
  );
}
