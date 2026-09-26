// The return shape of every server action: expected failures are values, not throws.
export type ActionResult<T, E> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: E };
