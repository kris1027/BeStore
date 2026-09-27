import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// spec 0005, AC-16: Vercel calls the expired cart cleanup once a day.

type VercelConfig = { crons?: readonly { path: string; schedule: string }[] };

const config = JSON.parse(
  readFileSync(new URL("./vercel.json", import.meta.url), "utf8"),
) as VercelConfig;

describe("vercel.json", () => {
  it("schedules the expired cart cron once a day", () => {
    const cron = config.crons?.find((entry) => entry.path === "/api/cron/expired-carts");

    // minute hour * * *: a fixed time, every day of every month.
    expect(cron?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});
