import { z } from "zod";

// Pure: which cron routes `pnpm cron:run` calls. vercel.json is the one list of crons, so a new
// cron is runnable locally the moment it is scheduled.

const vercelConfigSchema = z.object({
  crons: z.array(z.object({ path: z.string().startsWith("/api/cron/") })).default([]),
});

export type CronTargets =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export function cronTargets(vercelConfig: unknown, names: readonly string[]): CronTargets {
  const parsed = vercelConfigSchema.safeParse(vercelConfig);
  if (!parsed.success) return { ok: false, reason: "vercel.json has no readable crons list." };
  const all = parsed.data.crons.map((cron) => cron.path);
  if (names.length === 0) return { ok: true, paths: all };

  const known = new Map(all.map((path) => [path.slice("/api/cron/".length), path]));
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `Unknown cron ${unknown.join(", ")}. Known: ${[...known.keys()].join(", ")}.`,
    };
  }
  return { ok: true, paths: names.flatMap((name) => known.get(name) ?? []) };
}
