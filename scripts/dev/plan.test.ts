import { describe, expect, it } from "vitest";

import {
  appEnv,
  checkStripeKey,
  nextDevArgs,
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

describe("appEnv", () => {
  it("points every self link and the hook at the dev port, and email at Mailpit", () => {
    expect(appEnv(3100, "whsec_x")).toEqual({
      NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      SEND_EMAIL_HOOK_URI: "http://host.docker.internal:3100/api/auth/send-email",
      EMAIL_TRANSPORT: "mailpit",
      MAILPIT_URL: "http://127.0.0.1:55324",
    });
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
