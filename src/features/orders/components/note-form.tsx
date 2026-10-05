"use client";

import { useState } from "react";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";

import { addNote } from "../admin-actions";
import { NOTE_MAX_LENGTH, noteField } from "../schemas";
import { firstErrors, focusFirst, TextField, useOrderAction } from "./action-dialog";

const fieldId = "order-note";

// spec 0010, AC-19: any admin, any order, any status. Notes never conflict, so no stale check.
export function NoteForm({ orderNumber }: { readonly orderNumber: number }) {
  const hydrated = useHydrated();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const action = useOrderAction();

  function submit() {
    const parsed = noteField.safeParse(note);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      focusFirst([fieldId]);
      return;
    }
    setError(undefined);
    action.run(() => addNote({ orderNumber, note }), {
      success: "Note added",
      onSuccess: () => setNote(""),
      onFields: (fields) => {
        const message = firstErrors(fields).note;
        if (!message) return false;
        setError(message);
        focusFirst([fieldId]);
        return true;
      },
    });
  }

  return (
    <form
      noValidate
      aria-label="New note"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <FormNotice message={action.notice} />
      <TextField
        id={fieldId}
        label="Add a note"
        value={note}
        onChange={setNote}
        error={error}
        description="Only admins see notes."
        multiline
        maxLength={NOTE_MAX_LENGTH}
      />
      <Button
        type="submit"
        variant="outline"
        className="self-start"
        disabled={action.pending || !hydrated}
      >
        {action.pending ? <Spinner data-icon="inline-start" /> : null}
        Add note
      </Button>
    </form>
  );
}
