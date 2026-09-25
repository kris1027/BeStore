import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "../src/generated/prisma/client";
import { seedDemoCatalog } from "./demo-catalog";
import { seedRefusal } from "./seed-guard";

// `pnpm db:seed` (prisma db seed). Seeds DIRECT_URL, like migrations do.
config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DIRECT_URL;
  const refusal = seedRefusal(url, process.argv.slice(2));
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedDemoCatalog(db);
    console.log("Seeded the demo catalog.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
