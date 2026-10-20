import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const loader = require("./raw-text-loader.cjs") as (source: string) => string;

// spec 0017: what Turbopack bundles for a legal text.
describe("raw text loader", () => {
  it("exports the file text as the default string, quotes and newlines intact", () => {
    const source = '---\ntitle: "A"\n---\n\nIt\'s `{{seller.name}}` \\ done\n';
    const code = loader(source);

    expect(code).toBe(`export default ${JSON.stringify(source)};`);
    expect(JSON.parse(code.slice("export default ".length, -1))).toBe(source);
  });
});
