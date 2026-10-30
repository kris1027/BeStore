import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  appEnv,
  checkStripeKey,
  dockerSupabaseConfig,
  dockerSupabasePorts,
  envFile,
  nextDevArgs,
  parseStackStatus,
  parseWebhookSecret,
  sendEmailHookUri,
  socatArgs,
  stackNeedsRestart,
  stripeListenArgs,
  stripeSecretArgs,
  webhookEvents,
} from "./plan";

describe("stackNeedsRestart", () => {
  it("keeps a stack whose auth hook already points at the port", () => {
    const env = ["GOTRUE_SITE_URL=x", `GOTRUE_HOOK_SEND_EMAIL_URI=${sendEmailHookUri(3100)}`];

    expect(stackNeedsRestart(env, 3100)).toBe(false);
  });

  it("restarts a stack started for another port", () => {
    const env = [`GOTRUE_HOOK_SEND_EMAIL_URI=${sendEmailHookUri(3000)}`];

    expect(stackNeedsRestart(env, 3100)).toBe(true);
  });

  it("restarts a stack with no hook at all", () => {
    expect(stackNeedsRestart(["GOTRUE_SITE_URL=x"], 3100)).toBe(true);
  });
});

describe("stripe CLI arguments", () => {
  it("forwards to the app's webhook route on the host, with exactly the handled events", () => {
    const args = stripeListenArgs(3100);

    expect(args).toContain("http://host.docker.internal:3100/api/stripe/webhook");
    expect(args[args.indexOf("--events") + 1]).toBe(webhookEvents.join(","));
    expect(webhookEvents).toEqual([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "refund.created",
      "refund.updated",
      "refund.failed",
    ]);
  });

  it("never puts the API key in the arguments", () => {
    for (const args of [stripeListenArgs(3100), stripeSecretArgs()]) {
      expect(args.join(" ")).not.toMatch(/sk_|--api-key/);
      expect(args).toContain("STRIPE_API_KEY");
    }
  });
});

describe("parseWebhookSecret", () => {
  it("finds the secret in the CLI output", () => {
    expect(parseWebhookSecret("whsec_abc123DEF\n")).toBe("whsec_abc123DEF");
  });

  it("answers null when the CLI printed an error instead", () => {
    expect(parseWebhookSecret("Authorization failed")).toBeNull();
  });
});

describe("checkStripeKey", () => {
  it("accepts a test mode key", () => {
    expect(checkStripeKey("sk_test_123")).toEqual({ ok: true, key: "sk_test_123" });
  });

  it("refuses a live key", () => {
    expect(checkStripeKey("sk_live_123").ok).toBe(false);
  });

  it("refuses a missing key", () => {
    expect(checkStripeKey(undefined).ok).toBe(false);
  });
});

const stack = {
  API_URL: "http://127.0.0.1:56321",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:56322/postgres",
  ANON_KEY: "anon",
  SERVICE_ROLE_KEY: "service",
  MAILPIT_URL: "http://127.0.0.1:56324",
  STUDIO_URL: "http://127.0.0.1:56323",
};

describe("appEnv", () => {
  it("points the app at the Docker stack, every self link and the hook at the dev port, and email at its Mailpit", () => {
    expect(appEnv(3100, "whsec_x", stack)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:56322/postgres",
      DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:56322/postgres",
      MAILPIT_URL: "http://127.0.0.1:56324",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      SEND_EMAIL_HOOK_URI: "http://host.docker.internal:3100/api/auth/send-email",
      EMAIL_TRANSPORT: "mailpit",
    });
  });
});

describe("dockerSupabaseConfig", () => {
  const source = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
  const config = dockerSupabaseConfig(source);

  it("gives the Docker stack its own project id, so it gets its own containers and data", () => {
    expect(config).toMatch(/^project_id = "BeStore-docker"$/m);
    expect(config).not.toMatch(/^project_id = "BeStore"$/m);
  });

  it("moves every port off the ones the regular stack uses", () => {
    const portKeys = /^\s*(\w+_)?port = (\d+)$/gm;
    const before = [...source.matchAll(portKeys)].map((m) => Number(m[2]));
    const after = [...config.matchAll(portKeys)].map((m) => Number(m[2]));

    expect(after.length).toBeGreaterThan(5);
    expect(after).toEqual(before.map((port) => port + 1000));
    expect(config).toMatch(/^inspector_port = 9183$/m);
  });

  it("changes nothing else", () => {
    const strip = (text: string) =>
      text.replace(/^project_id = .*$/m, "").replace(/^(\s*(?:\w+_)?port = )\d+$/gm, "$1");

    expect(strip(config)).toBe(strip(source));
  });

  it("lists the ports the stack publishes, for the dev container to forward", () => {
    expect(dockerSupabasePorts(config)).toEqual(
      expect.arrayContaining([56321, 56322, 56323, 56324, 56327]),
    );
    expect(dockerSupabasePorts(config)).not.toContain(56320); // the shadow database is never published
  });

  it("refuses a config without a project id", () => {
    expect(() => dockerSupabaseConfig("[api]\nport = 1")).toThrow();
  });
});

describe("parseStackStatus", () => {
  it("reads the URLs from the CLI's JSON, ignoring notices around it", () => {
    const output = `Update available\n${JSON.stringify({ ...stack, JWT_SECRET: "x" })}\n`;

    expect(parseStackStatus(output)).toEqual(stack);
  });

  it("answers null when the stack isn't running", () => {
    expect(parseStackStatus("failed to inspect container health")).toBeNull();
  });
});

describe("envFile", () => {
  it("writes one KEY=value line per entry", () => {
    expect(envFile({ A: "1", B: "two" })).toBe("A=1\nB=two\n");
  });
});

describe("running inside the dev container", () => {
  it("listens on every interface only in the container, so the published port reaches it", () => {
    expect(nextDevArgs(3100, true)).toEqual([
      "exec",
      "next",
      "dev",
      "--port",
      "3100",
      "--hostname",
      "0.0.0.0",
    ]);
    expect(nextDevArgs(3100, false)).not.toContain("--hostname");
  });

  it("passes the container's own 127.0.0.1 port through to the same port on the host", () => {
    expect(socatArgs(55322)).toEqual([
      "TCP-LISTEN:55322,bind=127.0.0.1,fork,reuseaddr",
      "TCP:host.docker.internal:55322",
    ]);
  });
});
