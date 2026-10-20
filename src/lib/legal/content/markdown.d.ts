// The legal texts are imported as raw strings (the `raw` Turbopack rule in next.config.ts and
// the matching plugin in vitest.config.mts).
declare module "*.md" {
  const text: string;
  export default text;
}
