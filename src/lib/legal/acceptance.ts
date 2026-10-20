// spec 0017, AC-11 and AC-13: what an order records about the terms accepted at Pay. The version
// is the terms `updated` day at UTC midnight (a Postgres `date`); acceptedAt is the server's time
// at Pay. Written with the order and never changed; both or neither (a CHECK in the migration).
export type TermsAcceptance = { readonly version: Date; readonly acceptedAt: Date };
