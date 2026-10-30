import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { cronTargets } from "./targets";

const vercelConfig: unknown = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
);

describe("cronTargets", () => {
  it("runs every cron in vercel.json, in its order, when no name is given", () => {
    expect(cronTargets(vercelConfig, [])).toEqual({
      ok: true,
      paths: [
        "/api/cron/expired-carts",
        "/api/cron/reconcile-orders",
        "/api/cron/purge-expired-orders",
      ],
    });
  });

  it("runs only the named crons", () => {
    expect(cronTargets(vercelConfig, ["reconcile-orders"])).toEqual({
      ok: true,
      paths: ["/api/cron/reconcile-orders"],
    });
  });

  it("refuses an unknown name and lists the known ones", () => {
    const result = cronTargets(vercelConfig, ["nope"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("expired-carts");
  });

  it("refuses a config with no readable crons", () => {
    expect(cronTargets({ crons: [{ path: "/elsewhere" }] }, []).ok).toBe(false);
  });
});
