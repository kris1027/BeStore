"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldSet } from "@/components/ui/field";

import {
  acceptAllChoices,
  categoryUsed,
  type Choices,
  type CookieRegistry,
  type OptionalCategory,
  refusedAll,
} from "./consent";

export const categoryCopy = {
  necessary: {
    label: "Necessary",
    purpose: "Keep the store working: your cart, your sign in and this choice.",
  },
  analytics: {
    label: "Analytics",
    purpose: "Help us see how the store is used, so we can improve it.",
  },
  marketing: {
    label: "Marketing",
    purpose: "Help show you relevant offers on other sites.",
  },
} as const;

// spec 0017, AC-16: the three categories and three buttons. Refusing is as easy as accepting:
// Accept all and Reject all sit side by side in the same style (Key invariants).
export function ConsentDialog({
  open,
  onOpenChange,
  registry,
  granted,
  onSave,
  finalFocus,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly registry: CookieRegistry;
  readonly granted: Choices;
  readonly onSave: (next: Choices) => void;
  // Focus returns here on close; null lets the dialog pick.
  readonly finalFocus: HTMLElement | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        finalFocus={finalFocus === null ? true : () => finalFocus}
      >
        {/* Keyed by open, so each opening starts from the saved choice, not the last edits. */}
        {open ? (
          <ConsentForm registry={registry} granted={granted} onSave={onSave} />
        ) : (
          <DialogHeader>
            <DialogTitle>Cookie settings</DialogTitle>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConsentForm({
  registry,
  granted,
  onSave,
}: {
  readonly registry: CookieRegistry;
  readonly granted: Choices;
  readonly onSave: (next: Choices) => void;
}) {
  const [choices, setChoices] = useState<Choices>(() => ({
    analytics: granted.analytics && categoryUsed(registry, "analytics"),
    marketing: granted.marketing && categoryUsed(registry, "marketing"),
  }));

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">Cookie settings</DialogTitle>
        <DialogDescription>
          Choose which optional cookies we may use. Necessary cookies are always on. You can change
          this at any time from the footer. See the <a href="/cookies">cookie policy</a> for every
          cookie we use.
        </DialogDescription>
      </DialogHeader>
      <FieldSet className="gap-4">
        <legend className="sr-only">Cookie categories</legend>
        {/* No data-disabled on the fields: it fades the label text below AA contrast. */}
        <Field orientation="horizontal">
          <Checkbox
            id="consent-necessary"
            checked
            disabled
            aria-describedby="consent-necessary-hint"
          />
          <FieldContent>
            <FieldLabel htmlFor="consent-necessary">
              {categoryCopy.necessary.label}
              <span className="font-normal text-muted-foreground">Always on</span>
            </FieldLabel>
            <FieldDescription id="consent-necessary-hint">
              {categoryCopy.necessary.purpose}
            </FieldDescription>
          </FieldContent>
        </Field>
        {(["analytics", "marketing"] as const).map((category) => (
          <CategoryField
            key={category}
            category={category}
            used={categoryUsed(registry, category)}
            checked={choices[category]}
            onChange={(checked) => setChoices((current) => ({ ...current, [category]: checked }))}
          />
        ))}
      </FieldSet>
      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={() => onSave(choices)}>
          Save choices
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onSave(refusedAll)}>
            Reject all
          </Button>
          <Button variant="outline" onClick={() => onSave(acceptAllChoices(registry))}>
            Accept all
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function CategoryField({
  category,
  used,
  checked,
  onChange,
}: {
  readonly category: OptionalCategory;
  readonly used: boolean;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const id = `consent-${category}`;
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        checked={used && checked}
        disabled={!used}
        onCheckedChange={(value) => onChange(value === true)}
        aria-describedby={`${id}-hint`}
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>
          {categoryCopy[category].label}
          {used ? null : (
            <span className="font-normal text-muted-foreground">Not used right now</span>
          )}
        </FieldLabel>
        <FieldDescription id={`${id}-hint`}>{categoryCopy[category].purpose}</FieldDescription>
      </FieldContent>
    </Field>
  );
}
