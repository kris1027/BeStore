import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next config", () => {
  it("keeps Server Function arguments out of the dev log, so passwords and codes never print", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
  });
});
