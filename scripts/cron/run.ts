import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { config } from "dotenv";

import { devPort, siteUrl } from "../dev/plan";
import { cronTargets } from "./targets";

// `pnpm cron:run [name ...] [--url <base>]`: calls the cron routes the way Vercel Cron does, with
// `Authorization: Bearer ${CRON_SECRET}`. No names runs every cron in vercel.json, in its order.
// The base URL defaults to the `pnpm dev:docker` app; pass --url http://localhost:3000 for `pnpm dev`.
config({ path: [".env.local", ".env"], quiet: true });

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string", default: siteUrl(devPort) } },
});

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set in .env.local.");
  process.exit(1);
}

const vercelConfig: unknown = JSON.parse(readFileSync("vercel.json", "utf8"));
const targets = cronTargets(vercelConfig, positionals);
if (!targets.ok) {
  console.error(targets.reason);
  process.exit(1);
}

void callAll(targets.paths, values.url, secret).then((ok) => process.exit(ok ? 0 : 1));

async function callAll(paths: readonly string[], base: string, cronSecret: string) {
  let ok = true;
  for (const path of paths) {
    try {
      const response = await fetch(new URL(path, base), {
        headers: { Authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(120_000),
      });
      console.log(`${response.status} ${path} ${await response.text()}`);
      if (!response.ok) ok = false;
    } catch (error) {
      console.error(`failed ${path}: ${error instanceof Error ? error.message : String(error)}`);
      ok = false;
    }
  }
  return ok;
}
