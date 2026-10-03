// A user's search text as a literal inside LIKE / ILIKE: Prisma's `contains` passes % and _
// through as wildcards, so "100%" would match "1000". Backslash is Postgres's escape character.
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
