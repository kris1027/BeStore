// The store's identity, read everywhere the name or contact shows. A rebrand edits this file,
// fonts.ts beside it and the token block in app/globals.css (see docs/design.md).
// No next/* imports: React Email templates (feature 11) import it too.
export type SellerDetails = {
  // The legal name of the business, as registered.
  readonly name: string | null;
  // One line, as it should appear in the terms and the withdrawal form.
  readonly address: string | null;
  // NIP in Poland.
  readonly taxId: string | null;
  // The business register entry (KRS or CEIDG) and number.
  readonly registration: string | null;
  readonly email: string | null;
  readonly phone: string | null;
};

export const brand: {
  readonly name: string;
  readonly contactEmail: string | null;
  // The seller named in the legal pages (spec 0017, AC-4). A null field renders a
  // `[[TO FILL]]` marker, which a production build refuses.
  readonly legal: SellerDetails;
} = {
  name: "BeStore",
  contactEmail: null,
  legal: {
    name: null,
    address: null,
    taxId: null,
    registration: null,
    email: null,
    phone: null,
  },
};
