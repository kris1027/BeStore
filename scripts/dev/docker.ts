import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import {
  appEnv,
  authContainer,
  checkStripeKey,
  devPort,
  dockerSupabaseConfig,
  dockerSupabasePorts,
  dockerWorkdir,
  envFile,
  nextDevArgs,
  parseStackStatus,
  parseWebhookSecret,
  sendEmailHookUri,
  siteUrl,
  socatArgs,
  stackEnv,
  stackNeedsRestart,
  stripeListenArgs,
  stripeListenContainer,
  stripeSecretArgs,
} from "./plan";

// The whole store locally, every feature wired. `docker compose up` (`pnpm dev:docker`) runs this
// in the dev container; Supabase (database, auth, storage, Mailpit) and the Stripe CLI run as
// sibling containers through the mounted Docker socket. Run directly with tsx it works on the host
// too. It uses its own empty Supabase stack (see dockerProjectId), never the `pnpm db:start` one.
// Local only: it refuses live Stripe keys and never reads a deployed environment.
config({ path: [".env.local", ".env"], quiet: true });

const inDocker = process.env.BESTORE_IN_DOCKER === "1";

const stripeKey = checkStripeKey(process.env.STRIPE_SECRET_KEY);
if (!stripeKey.ok) fail(stripeKey.reason);
const childEnv = { ...process.env, STRIPE_API_KEY: stripeKey.key };

if (run("docker", ["info"], { quiet: true }).status !== 0) {
  fail("Docker is not running. Start Docker Desktop (or your container runtime) and try again.");
}

const dockerConfig = dockerSupabaseConfig(readFileSync(join("supabase", "config.toml"), "utf8"));
mkdirSync(join(dockerWorkdir, "supabase"), { recursive: true });
writeFileSync(join(dockerWorkdir, "supabase", "config.toml"), dockerConfig);

// Before the stack starts: the Supabase CLI itself dials 127.0.0.1 to check the database is up.
const forwards = inDocker
  ? dockerSupabasePorts(dockerConfig).map((port) =>
      spawn("socat", socatArgs(port), { stdio: "ignore" }),
    )
  : [];
startStack();
const status = run(
  "pnpm",
  ["exec", "supabase", "status", "-o", "json", "--workdir", dockerWorkdir],
  {
    capture: true,
  },
);
const stack = parseStackStatus(status.stdout);
if (!stack) fail(`Could not read the Supabase stack's URLs:\n${status.stderr}`);
// For the scripts you run beside it, e.g. `pnpm admin:create --env-file .dev-docker/stack.env`.
writeFileSync(join(dockerWorkdir, "stack.env"), envFile(stackEnv(stack)));

step("Applying migrations");
must(
  run("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, ...stackEnv(stack) },
  }),
);

step("Starting Stripe webhook forwarding");
run("docker", ["rm", "--force", stripeListenContainer], { quiet: true });
const secret = run("docker", stripeSecretArgs(), { capture: true, env: childEnv });
const webhookSecret = parseWebhookSecret(secret.stdout);
if (!webhookSecret)
  fail(`Could not read the webhook secret from the Stripe CLI:\n${secret.stderr}`);
must(run("docker", stripeListenArgs(devPort), { quiet: true, env: childEnv }));

console.log(`
  Store        ${siteUrl(devPort)}
  Mailpit      ${stack.MAILPIT_URL}   (every email, auth and order)
  Studio       ${stack.STUDIO_URL}
  Admin        ${inDocker ? "docker compose exec dev " : ""}pnpm admin:create --env-file ${dockerWorkdir}/stack.env --email <you> --name <name>
  Stripe logs  docker logs --follow ${stripeListenContainer}
  Crons        ${inDocker ? "docker compose exec dev pnpm cron:run" : "pnpm cron:run"}
  Stop         Ctrl+C (Supabase keeps running; pnpm dev:docker:stop stops it, pnpm dev:docker:reset empties it)
`);

const app = spawn("pnpm", nextDevArgs(devPort, inDocker), {
  stdio: "inherit",
  env: { ...process.env, ...appEnv(devPort, webhookSecret, stack) },
});
const stop = () => app.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  run("docker", ["rm", "--force", stripeListenContainer], { quiet: true });
  for (const forward of forwards) forward.kill();
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
    must(run("pnpm", ["exec", "supabase", "stop", "--workdir", dockerWorkdir]));
  } else {
    step("Starting Supabase");
  }
  must(run("pnpm", ["exec", "supabase", "start", "--workdir", dockerWorkdir], { env: hookEnv }));
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
