import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Boundaries: the Postgres driver adapter, the generated Prisma client, and the env module.
const { PrismaPg, PrismaClient } = vi.hoisted(() => ({
  PrismaPg: vi.fn(
    class {
      constructor(public options: { connectionString: string }) {}
    },
  ),
  PrismaClient: vi.fn(
    class {
      constructor(public options: { adapter: unknown }) {}
    },
  ),
}));

vi.mock("server-only", () => ({}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient }));
vi.mock("@/lib/env", () => ({
  env: { DATABASE_URL: "postgresql://pooler.example:6543/postgres?pgbouncer=true" },
}));

const globalForPrisma = globalThis as unknown as { prisma?: unknown };

async function loadDb() {
  const { db } = await import("./db");
  return db;
}

describe("db", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete globalForPrisma.prisma;
  });

  afterEach(() => {
    delete globalForPrisma.prisma;
  });

  it("connects through the pg adapter using DATABASE_URL (the pooler)", async () => {
    const db = await loadDb();

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://pooler.example:6543/postgres?pgbouncer=true",
    });
    expect(PrismaClient).toHaveBeenCalledWith({ adapter: PrismaPg.mock.instances[0] });
    expect(db).toBe(PrismaClient.mock.instances[0]);
  });

  it("reuses the client already stored on globalThis instead of opening a new one", async () => {
    const existing = { reused: true };
    globalForPrisma.prisma = existing;

    const db = await loadDb();

    expect(db).toBe(existing);
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  it("stores the client on globalThis outside production, so hot reloads share one", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const db = await loadDb();

    expect(globalForPrisma.prisma).toBe(db);
  });

  it("does not store the client on globalThis in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await loadDb();

    expect(globalForPrisma.prisma).toBeUndefined();
  });
});
