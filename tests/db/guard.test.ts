import { describe, expect, it } from "vitest";

import { safeTestDatabaseUrl } from "./guard";

const dev = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const test = "postgresql://postgres:postgres@127.0.0.1:55322/bestore_test";

describe("safeTestDatabaseUrl", () => {
  it("returns TEST_DATABASE_URL when it names its own database", () => {
    expect(
      safeTestDatabaseUrl({ TEST_DATABASE_URL: test, DATABASE_URL: dev, DIRECT_URL: dev }),
    ).toBe(test);
  });

  it("refuses when TEST_DATABASE_URL is unset or empty", () => {
    expect(() => safeTestDatabaseUrl({ DIRECT_URL: dev })).toThrow(/not set/);
    expect(() => safeTestDatabaseUrl({ TEST_DATABASE_URL: "" })).toThrow(/not set/);
  });

  it("refuses when it is the DIRECT_URL database", () => {
    expect(() => safeTestDatabaseUrl({ TEST_DATABASE_URL: dev, DIRECT_URL: dev })).toThrow(
      /DIRECT_URL/,
    );
  });

  it("refuses the DATABASE_URL database even behind other params or localhost", () => {
    expect(() =>
      safeTestDatabaseUrl({
        TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:55322/postgres",
        DATABASE_URL: `${dev}?pgbouncer=true`,
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
