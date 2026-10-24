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
  // sRGB hex copies of the --background and --foreground tokens in app/globals.css, for the
  // generated share card and logo (spec 0018, AC-3): next/og cannot read oklch CSS tokens. A
  // rebrand updates them with the tokens; brand.test.ts fails until it does.
  readonly colors: { readonly background: string; readonly foreground: string };
  readonly contactEmail: string | null;
  // The seller named in the legal pages (spec 0017, AC-4). A null field renders a
  // `[[TO FILL]]` marker, which a production build refuses.
  readonly legal: SellerDetails;
} = {
  name: "BeStore",
  colors: { background: "#ffffff", foreground: "#0a0a0a" },
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
