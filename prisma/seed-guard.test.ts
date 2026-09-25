import { describe, expect, it } from "vitest";

import { seedRefusal } from "./seed-guard";

const local = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const remote =
  "postgresql://postgres.abc:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

describe("seedRefusal", () => {
  it.each([local, "postgresql://postgres@localhost:5432/postgres"])(
    "allows the local host %s",
    (url) => {
      expect(seedRefusal(url, [])).toBeNull();
    },
  );

  it("refuses a remote host and names it", () => {
    expect(seedRefusal(remote, [])).toMatch(/aws-0-eu-central-1\.pooler\.supabase\.com/);
  });

  it("allows a remote host when --yes is passed", () => {
    expect(seedRefusal(remote, ["--yes"])).toBeNull();
  });

  it("refuses when DIRECT_URL is missing, even with --yes", () => {
    expect(seedRefusal(undefined, ["--yes"])).toMatch(/not set/);
  });
});
