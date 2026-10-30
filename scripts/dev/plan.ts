import { z } from "zod";

import { handledEventTypes, refundEventTypes } from "@/lib/orders/webhook-events";

// Pure planning for `pnpm dev:docker`: every value the run derives, so the I/O in docker.ts
// only executes it. Supabase (with Mailpit) and the Stripe CLI run in Docker, and both reach the
// app through host.docker.internal.

export const devPort = 3100;

// Pinned, never `latest`: a CLI update must not change local webhooks under you.
export const stripeCliImage = "stripe/stripe-cli:v1.52.0";
export const stripeListenContainer = "bestore-stripe-listen";

// Its own Supabase stack, never the one `pnpm db:start` runs: the CLI keys containers and data
// volumes by `project_id`, so a second id gives a second database that starts empty, keeps its
// data between runs, and can run beside the first on its own ports. The CLI reads
// `<workdir>/supabase/config.toml`, written fresh from supabase/config.toml on every start, so
// the two stacks never drift apart in anything but the id and ports.
export const dockerProjectId = "BeStore-docker";
export const dockerWorkdir = ".dev-docker";
export const authContainer = `supabase_auth_${dockerProjectId}`;
const portOffset = 1000;

// Every port key outside a comment (`port`, `shadow_port`, `inspector_port`, ...) moves up by
// portOffset (55321 → 56321), so no port is shared with the regular stack. Auth's site_url, its
// fallback redirect, follows the app to devPort.
export function dockerSupabaseConfig(source: string): string {
  const projectLine = /^project_id = ".*"$/m;
  if (!projectLine.test(source)) throw new Error("supabase/config.toml has no project_id line.");
  return source
    .replace(projectLine, `project_id = "${dockerProjectId}"`)
    .replace(/^site_url = ".*"$/m, `site_url = "${siteUrl(devPort)}"`)
    .replace(
      /^(\s*(?:\w+_)?port = )(\d+)$/gm,
      (_line, key: string, port: string) => `${key}${Number(port) + portOffset}`,
    );
}

// The ports the stack's services publish on the host (each section's plain `port`), read from the
// written config so they follow supabase/config.toml and portOffset.
export function dockerSupabasePorts(config: string): readonly number[] {
  return [...config.matchAll(/^\s*port = (\d+)$/gm)].map((match) => Number(match[1]));
}

const statusSchema = z.object({
  API_URL: z.url(),
  DB_URL: z.string().startsWith("postgresql://"),
  ANON_KEY: z.string().min(1),
  SERVICE_ROLE_KEY: z.string().min(1),
  MAILPIT_URL: z.url(),
  STUDIO_URL: z.url(),
});

export type StackUrls = z.infer<typeof statusSchema>;

// `supabase status -o json` for the Docker stack; null when it isn't running or printed no JSON.
export function parseStackStatus(output: string): StackUrls | null {
  const json = output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  const parsed = statusSchema.safeParse(parseJson(json));
  return parsed.success ? parsed.data : null;
}

// What points the app, migrations and the admin scripts at the Docker stack instead of the one
// .env.local names. Locally there is no pooler, so both database URLs are the direct one.
export function stackEnv(stack: StackUrls): Readonly<Record<string, string>> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: stack.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: stack.SERVICE_ROLE_KEY,
    DATABASE_URL: stack.DB_URL,
    DIRECT_URL: stack.DB_URL,
    MAILPIT_URL: stack.MAILPIT_URL,
  };
}

export function envFile(values: Readonly<Record<string, string>>): string {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

export const webhookEvents: readonly string[] = [...handledEventTypes, ...refundEventTypes];

// Under `docker compose up` (compose.yaml sets BESTORE_IN_DOCKER), the stack's ports on 127.0.0.1
// belong to the host, not this container. socat answers on the container's own 127.0.0.1 and
// passes each through, so the same URLs work in the container and in your browser.

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

const authInspectSchema = z.object({
  State: z.object({ Running: z.boolean() }),
  Config: z.object({ Env: z.array(z.string()) }),
});

export type StackAction = "start" | "restart" | "keep";

// From `docker inspect <auth container>`, null when it doesn't exist. A container left stopped
// (after Docker restarts, say) gets the same stop and start as a stale hook; a running one with the
// right hook is kept as it is.
export function stackAction(inspectOutput: string | null, port: number): StackAction {
  if (inspectOutput === null) return "start";
  const parsed = authInspectSchema.safeParse(parseJson(inspectOutput));
  if (!parsed.success || !parsed.data.State.Running) return "restart";
  return stackNeedsRestart(parsed.data.Config.Env, port) ? "restart" : "keep";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
export function appEnv(
  port: number,
  webhookSecret: string,
  stack: StackUrls,
): Readonly<Record<string, string>> {
  return {
    ...stackEnv(stack),
    NEXT_PUBLIC_SITE_URL: siteUrl(port),
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    SEND_EMAIL_HOOK_URI: sendEmailHookUri(port),
    EMAIL_TRANSPORT: "mailpit",
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
