import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

// Server side field errors (the same Zod schema, parsed again in the action) onto the form.
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fields: Partial<Record<Path<T>, readonly string[]>> | undefined,
) {
  if (!fields) return;
  let first = true;
  for (const [name, messages] of Object.entries(fields) as [Path<T>, readonly string[]][]) {
    const message = messages[0];
    if (!message) continue;
    setError(name, { type: "server", message }, { shouldFocus: first });
    first = false;
  }
}
