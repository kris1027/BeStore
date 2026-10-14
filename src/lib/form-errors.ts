import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { z } from "zod";

// Field errors from a failed Zod parse in a server action, keyed by field name.
export function fieldErrors<T extends string>(
  error: z.ZodError,
): Partial<Record<T, readonly string[]>> {
  return z.flattenError(error).fieldErrors as Partial<Record<T, readonly string[]>>;
}

// Server side field errors (the same Zod schema, parsed again in the action) onto the form,
// focusing the first invalid field.
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
