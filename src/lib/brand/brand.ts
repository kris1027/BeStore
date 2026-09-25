// The store's identity, read everywhere the name or contact shows. A rebrand edits this file,
// fonts.ts beside it and the token block in app/globals.css (see docs/design.md).
// No next/* imports: React Email templates (feature 11) import it too.
export const brand: {
  readonly name: string;
  readonly contactEmail: string | null;
} = {
  name: "BeStore",
  contactEmail: null,
};
