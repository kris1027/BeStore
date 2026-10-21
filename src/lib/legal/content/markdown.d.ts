// The legal texts are imported as raw strings (the Turbopack rule running
// scripts/raw-text-loader.cjs in next.config.ts, and the matching plugin in vitest.config.mts).
declare module "*.md" {
  const text: string;
  export default text;
}
