import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

// One client per server process; reuse it across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // DATABASE_URL is the Supabase pooler in transaction mode (serverless safe).
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// The client handed to an interactive $transaction callback.
export type Tx = Prisma.TransactionClient;

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
