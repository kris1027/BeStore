import { beforeEach, describe, expect, it, vi } from "vitest";

import { type EnvKey, stubEnv, validEnv } from "../../tests/valid-env";

// env.ts validates process.env when it is first imported, so each test loads a fresh copy.
async function loadEnv() {
  const mod = await import("./env");
  return mod.env;
}

describe("env", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exports the parsed values when every variable is valid", async () => {
    stubEnv();

    await expect(loadEnv()).resolves.toEqual(validEnv);
  });

  it("stays hermetic when the shell sets TEST_DATABASE_URL, as CI does", async () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bestore_test");
    stubEnv();

    await expect(loadEnv()).resolves.toEqual(validEnv);
  });

  describe("TEST_DATABASE_URL", () => {
    it("treats a blank value, as copied from .env.example, as unset", async () => {
      stubEnv();
      vi.stubEnv("TEST_DATABASE_URL", "");

      const env = await loadEnv();

      expect(env.TEST_DATABASE_URL).toBeUndefined();
    });

    it("keeps a valid PostgreSQL URL", async () => {
      const url = "postgresql://postgres:postgres@127.0.0.1:55322/bestore_test";
      stubEnv();
      vi.stubEnv("TEST_DATABASE_URL", url);

      const env = await loadEnv();

      expect(env.TEST_DATABASE_URL).toBe(url);
    });

    it("still rejects a value that is not a PostgreSQL URL", async () => {
      stubEnv();
      vi.stubEnv("TEST_DATABASE_URL", "https://example.com/db");

      await expect(loadEnv()).rejects.toThrow("TEST_DATABASE_URL");
    });
  });

  it("does not expose variables outside the schema", async () => {
    stubEnv();
    vi.stubEnv("UNRELATED_SECRET", "should-not-leak");

    const env = await loadEnv();

    expect(env).not.toHaveProperty("UNRELATED_SECRET");
  });

  it.each(Object.keys(validEnv) as EnvKey[])(
    "fails and names %s when it is missing",
    async (key) => {
      stubEnv({ [key]: undefined });

      await expect(loadEnv()).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringMatching(
            new RegExp(`Invalid environment variables[\\s\\S]*${key}`),
          ),
        }),
      );
    },
  );

  it.each([
    "DATABASE_URL",
    "DIRECT_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SITE_URL",
  ] as const)("rejects %s when it is not a URL", async (key) => {
    stubEnv({ [key]: "localhost-without-scheme" });

    await expect(loadEnv()).rejects.toThrow(key);
  });

  it.each(["DATABASE_URL", "DIRECT_URL"] as const)(
    "rejects %s when it is not a PostgreSQL URL",
    async (key) => {
      stubEnv({ [key]: "https://supabase.com/dashboard/project/abc" });

      await expect(loadEnv()).rejects.toThrow("PostgreSQL connection string");
    },
  );

  it.each(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const)(
    "rejects an empty %s, as left by a copied .env.example",
    async (key) => {
      stubEnv({ [key]: "" });

      await expect(loadEnv()).rejects.toThrow(key);
    },
  );

  describe("CART_COOKIE_SECRET", () => {
    it("accepts exactly 32 characters", async () => {
      stubEnv({ CART_COOKIE_SECRET: "x".repeat(32) });

      await expect(loadEnv()).resolves.toMatchObject({ CART_COOKIE_SECRET: "x".repeat(32) });
    });

    it("rejects 31 characters", async () => {
      stubEnv({ CART_COOKIE_SECRET: "x".repeat(31) });

      await expect(loadEnv()).rejects.toThrow("CART_COOKIE_SECRET");
    });

    it("does not print the rejected secret in the error", async () => {
      const weakSecret = "weak-secret-value";
      stubEnv({ CART_COOKIE_SECRET: weakSecret });

      const error = await loadEnv().catch((e: Error) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(weakSecret);
    });
  });

  describe("STORE_CURRENCY", () => {
    it.each(["EUR", "PLN", "USD"])("accepts the ISO 4217 code %s", async (code) => {
      stubEnv({ STORE_CURRENCY: code });

      await expect(loadEnv()).resolves.toMatchObject({ STORE_CURRENCY: code });
    });

    it.each(["euro", "eur", "EURO", "EU", "E1R", " EUR"])(
      "rejects %j with the ISO 4217 hint",
      async (code) => {
        stubEnv({ STORE_CURRENCY: code });

        await expect(loadEnv()).rejects.toThrow("ISO 4217 code, e.g. EUR");
      },
    );
  });

  describe("STORE_TIMEZONE", () => {
    it.each(["Europe/Warsaw", "America/New_York", "America/Argentina/Buenos_Aires", "UTC"])(
      "accepts the IANA zone %s",
      async (zone) => {
        stubEnv({ STORE_TIMEZONE: zone });

        await expect(loadEnv()).resolves.toMatchObject({ STORE_TIMEZONE: zone });
      },
    );

    it.each([
      "Mars/Olympus_Mons",
      "Warsaw",
      "not a zone",
      "+02:00",
      "EST",
      "CET",
      "europe/warsaw",
      "Etc/GMT-2",
    ])("rejects %j with the IANA hint", async (zone) => {
      stubEnv({ STORE_TIMEZONE: zone });

      await expect(loadEnv()).rejects.toThrow("IANA timezone, e.g. Europe/Warsaw");
    });
  });
});
