import { describe, expect, it } from "vitest";

import { testDb } from "./client";

// AC-2: the browser reaches nothing through Supabase's Data API.
describe("row level security", () => {
  it("is enabled on every public table, including _prisma_migrations", async () => {
    const tables = await testDb.$queryRaw<{ relname: string; rls: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`;

    expect(tables.map((t) => t.relname)).toContain("_prisma_migrations");
    expect(tables.filter((t) => !t.rls).map((t) => t.relname)).toEqual([]);
  });

  it("has no policies, so anon and authenticated roles see no rows", async () => {
    const [row] = await testDb.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_policies WHERE schemaname = 'public'`;

    expect(row?.count).toBe(0);
  });
});
