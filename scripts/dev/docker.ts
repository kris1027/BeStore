import { spawn, spawnSync } from "node:child_process";

import { config } from "dotenv";

import {
  appEnv,
  authContainer,
  checkStripeKey,
  devPort,
  parseWebhookSecret,
  sendEmailHookUri,
  siteUrl,
  stackNeedsRestart,
  stripeListenArgs,
  stripeListenContainer,
  stripeSecretArgs,
} from "./plan";

// `pnpm dev:docker`: the whole store locally, every feature wired. Supabase (database, auth,
// storage, Mailpit) and the Stripe CLI run in Docker; Next.js runs on the host for fast reloads.
// Local only: it refuses live Stripe keys and never reads a deployed environment.
config({ path: [".env.local", ".env"], quiet: true });

const stripeKey = checkStripeKey(process.env.STRIPE_SECRET_KEY);
if (!stripeKey.ok) fail(stripeKey.reason);
const childEnv = { ...process.env, STRIPE_API_KEY: stripeKey.key };

if (run("docker", ["info"], { quiet: true }).status !== 0) {
  fail("Docker is not running. Start Docker Desktop (or your container runtime) and try again.");
}

startStack();
step("Applying migrations");
must(run("pnpm", ["exec", "prisma", "migrate", "deploy"]));

step("Starting Stripe webhook forwarding");
run("docker", ["rm", "--force", stripeListenContainer], { quiet: true });
const secret = run("docker", stripeSecretArgs(), { capture: true, env: childEnv });
const webhookSecret = parseWebhookSecret(secret.stdout);
if (!webhookSecret)
  fail(`Could not read the webhook secret from the Stripe CLI:\n${secret.stderr}`);
must(run("docker", stripeListenArgs(devPort), { quiet: true, env: childEnv }));

console.log(`
  Store        ${siteUrl(devPort)}
  Mailpit      http://127.0.0.1:55324   (every email, auth and order)
  Studio       http://127.0.0.1:55323
  Stripe logs  docker logs --follow ${stripeListenContainer}
  Crons        pnpm cron:run
  Stop         Ctrl+C (Supabase keeps running; pnpm db:stop stops it)
`);

const app = spawn("pnpm", ["exec", "next", "dev", "--port", String(devPort)], {
  stdio: "inherit",
  env: { ...process.env, ...appEnv(devPort, webhookSecret) },
});
const stop = () => app.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  run("docker", ["rm", "--force", stripeListenContainer], { quiet: true });
  process.exit(code ?? 0);
});

function startStack() {
  const hookEnv = { ...process.env, SEND_EMAIL_HOOK_URI: sendEmailHookUri(devPort) };
  const inspect = run("docker", ["inspect", authContainer, "--format", "{{json .Config.Env}}"], {
    capture: true,
  });
  if (inspect.status === 0) {
    const containerEnv: unknown = JSON.parse(inspect.stdout);
    const lines = Array.isArray(containerEnv) ? containerEnv.map(String) : [];
    if (!stackNeedsRestart(lines, devPort)) return;
    step(`Restarting Supabase so auth emails reach port ${devPort} (your data is kept)`);
    must(run("pnpm", ["exec", "supabase", "stop"]));
  } else {
    step("Starting Supabase");
  }
  must(run("pnpm", ["exec", "supabase", "start"], { env: hookEnv }));
}

type RunOptions = {
  readonly quiet?: boolean;
  readonly capture?: boolean;
  readonly env?: NodeJS.ProcessEnv;
};

function run(command: string, args: readonly string[], options: RunOptions = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture || options.quiet ? "pipe" : "inherit",
    env: options.env ?? process.env,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function must(result: { readonly status: number | null; readonly stderr: string }) {
  if (result.status !== 0) fail(result.stderr || "The step above failed.");
}

function step(message: string) {
  console.log(`\n▸ ${message}`);
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}
