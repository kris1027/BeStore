import { handledEventTypes, refundEventTypes } from "@/features/orders/event-decision";

// Pure planning for `pnpm dev:docker`: every value the run derives, so the I/O in docker.ts
// only executes it. The app runs on the host; Supabase (with Mailpit) and the Stripe CLI run in
// Docker, and both reach the app through host.docker.internal.

export const devPort = 3100;

// Pinned, never `latest`: a CLI update must not change local webhooks under you.
export const stripeCliImage = "stripe/stripe-cli:v1.52.0";
export const stripeListenContainer = "bestore-stripe-listen";

// The Supabase CLI names the auth container after `project_id` in supabase/config.toml.
export const authContainer = "supabase_auth_BeStore";

// Exactly the events the webhook acts on, as the staging and production endpoints subscribe.
export const webhookEvents: readonly string[] = [...handledEventTypes, ...refundEventTypes];

// Under `docker compose up` (compose.yaml sets BESTORE_IN_DOCKER), the Supabase ports .env.local
// names on 127.0.0.1 belong to the host, not this container. socat answers on the container's
// own 127.0.0.1 and passes each through, so .env.local works unchanged in both places.
export const supabaseHostPorts: readonly number[] = [55321, 55322, 55323, 55324];

export function socatArgs(port: number): readonly string[] {
  return [`TCP-LISTEN:${port},bind=127.0.0.1,fork,reuseaddr`, `TCP:host.docker.internal:${port}`];
}

// The browser reaches a container's Next.js only through the published port, so it must listen
// on every interface there; on the host it stays on localhost.
export function nextDevArgs(port: number, inDocker: boolean): readonly string[] {
  const base = ["exec", "next", "dev", "--port", String(port)];
  return inDocker ? [...base, "--hostname", "0.0.0.0"] : base;
}

export function siteUrl(port: number): string {
  return `http://localhost:${port}`;
}

// Read by the Supabase CLI through env() in config.toml, only when the stack starts.
export function sendEmailHookUri(port: number): string {
  return `http://host.docker.internal:${port}/api/auth/send-email`;
}

// The auth container keeps the hook URI it started with, so a stack started for another port
// (plain `pnpm dev` on 3000) sends every auth email to the wrong place until it restarts.
export function stackNeedsRestart(containerEnv: readonly string[], port: number): boolean {
  const current = containerEnv
    .find((line) => line.startsWith("GOTRUE_HOOK_SEND_EMAIL_URI="))
    ?.slice("GOTRUE_HOOK_SEND_EMAIL_URI=".length);
  return current !== sendEmailHookUri(port);
}

// The key travels as STRIPE_API_KEY from the caller's env (`--env` with no value), never as an
// argument, so it stays out of `ps` output and shell history.
export function stripeListenArgs(port: number): readonly string[] {
  return [
    "run",
    "--rm",
    "--detach",
    "--name",
    stripeListenContainer,
    // Docker Desktop resolves host.docker.internal itself; Linux needs the mapping.
    "--add-host=host.docker.internal:host-gateway",
    "--env",
    "STRIPE_API_KEY",
    stripeCliImage,
    "listen",
    "--forward-to",
    `http://host.docker.internal:${port}/api/stripe/webhook`,
    "--events",
    webhookEvents.join(","),
  ];
}

// `listen --print-secret` answers with the same whsec_ secret the forwarding session signs with,
// for as long as the API key stays the same.
export function stripeSecretArgs(): readonly string[] {
  return ["run", "--rm", "--env", "STRIPE_API_KEY", stripeCliImage, "listen", "--print-secret"];
}

export function parseWebhookSecret(output: string): string | null {
  return /whsec_\w+/.exec(output)?.[0] ?? null;
}

// Next.js never overrides a variable already in process.env with .env.local, so these win.
export function appEnv(port: number, webhookSecret: string): Readonly<Record<string, string>> {
  return {
    NEXT_PUBLIC_SITE_URL: siteUrl(port),
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    SEND_EMAIL_HOOK_URI: sendEmailHookUri(port),
    EMAIL_TRANSPORT: "mailpit",
    MAILPIT_URL: "http://127.0.0.1:55324",
  };
}

export type KeyCheck =
  { readonly ok: true; readonly key: string } | { readonly ok: false; readonly reason: string };

// A live key would forward real payments' events to a laptop; only test mode belongs here.
export function checkStripeKey(key: string | undefined): KeyCheck {
  if (!key) return { ok: false, reason: "STRIPE_SECRET_KEY is not set in .env.local." };
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    return { ok: false, reason: "STRIPE_SECRET_KEY must be a test mode key (sk_test_...)." };
  }
  return { ok: true, key };
}
