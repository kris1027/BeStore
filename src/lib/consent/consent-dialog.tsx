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
import { legalPaths } from "@/lib/legal/paths";

import {
  acceptAllChoices,
  categoryUsed,
  type Choices,
  choicesFrom,
  type ConsentCategory,
  consentCategoryLabels,
  type CookieRegistry,
  type OptionalCategory,
  optionalCategories,
  refusedAll,
} from "./consent";

const categoryPurposes: Readonly<Record<ConsentCategory, string>> = {
  necessary: "Keep the store working: your cart, your sign in and this choice.",
  analytics: "Help us see how the store is used, so we can improve it.",
  marketing: "Help show you relevant offers on other sites.",
};

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
  const [choices, setChoices] = useState<Choices>(() =>
    choicesFrom((category) => granted[category] && categoryUsed(registry, category)),
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">Cookie settings</DialogTitle>
        <DialogDescription>
          Choose which optional cookies we may use. Necessary cookies are always on. You can change
          this at any time from the footer. See the <a href={legalPaths.cookies}>cookie policy</a>{" "}
          for every cookie we use.
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
              {consentCategoryLabels.necessary}
              <span className="font-normal text-muted-foreground">Always on</span>
            </FieldLabel>
            <FieldDescription id="consent-necessary-hint">
              {categoryPurposes.necessary}
            </FieldDescription>
          </FieldContent>
        </Field>
        {optionalCategories.map((category) => (
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
          {consentCategoryLabels[category]}
          {used ? null : (
            <span className="font-normal text-muted-foreground">Not used right now</span>
          )}
        </FieldLabel>
        <FieldDescription id={`${id}-hint`}>{categoryPurposes[category]}</FieldDescription>
      </FieldContent>
    </Field>
  );
}
