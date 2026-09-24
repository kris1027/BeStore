import { beforeEach, describe, expect, it, vi } from "vitest";

import { stubEnv } from "./tests/valid-env";

async function register() {
  const mod = await import("./instrumentation");
  return mod.register();
}

describe("register (server boot hook)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("fails boot on the Node.js runtime when an environment variable is invalid", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    stubEnv({ STORE_CURRENCY: "euro" });

    await expect(register()).rejects.toThrow(/Invalid environment variables[\s\S]*STORE_CURRENCY/);
  });

  it("boots on the Node.js runtime when the environment is valid", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    stubEnv();

    await expect(register()).resolves.toBeUndefined();
  });

  it("skips the env check on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    stubEnv({ STORE_CURRENCY: "euro" });

    await expect(register()).resolves.toBeUndefined();
  });
});
