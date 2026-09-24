import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Match Next.js: .env.local wins over .env.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations use the direct (or session mode) connection, never the pooler.
    url: process.env.DIRECT_URL,
  },
});
