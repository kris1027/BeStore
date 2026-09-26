import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as OTPAuth from "otpauth";
import pg from "pg";

// Real local Supabase, never a mock (spec 0004): every test makes its own admin with a unique
// email through the Auth admin API, plus its admin_users row.
config({ path: [".env.local", ".env"], quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; the admin e2e tests need the local stack.`);
  return value;
}

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
// Mailpit, from the Supabase CLI stack (supabase/config.toml [inbucket]).
const mailpitUrl = "http://127.0.0.1:55324";

// These tests write users; refuse anything but a local stack.
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(supabaseUrl)) {
  throw new Error("The admin e2e tests only run against a local Supabase stack.");
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const testPassword = "Correct-horse-9";

export type TestUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly password: string;
  // Base32 TOTP secret, when a factor is enrolled.
  readonly secret: string | null;
};

async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: required("DIRECT_URL") });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

type CreateOptions = {
  // An auth user with no admin_users row, such as a future customer.
  readonly admin?: boolean;
  readonly enrolled?: boolean;
};

export async function createTestUser(options: CreateOptions = {}): Promise<TestUser> {
  const { admin = true, enrolled = false } = options;
  const email = `e2e-${randomUUID()}@example.com`;
  const name = `Admin ${email.slice(4, 10)}`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password: testPassword,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user.id;

  if (admin) {
    await withDb((db) =>
      db.query("INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)", [id, email, name]),
    );
  }
  const secret = enrolled ? await enrollFactor(email) : null;
  return { id, email, name, password: testPassword, secret };
}

// Enrolls and verifies a TOTP factor through the Auth API, as the user would in the app.
async function enrollFactor(email: string): Promise<string> {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password: testPassword });
  if (signIn.error) throw signIn.error;
  const enroll = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "e2e" });
  if (enroll.error) throw enroll.error;
  const verify = await client.auth.mfa.challengeAndVerify({
    factorId: enroll.data.id,
    code: await totpCode(enroll.data.totp.secret),
  });
  if (verify.error) throw verify.error;
  await client.auth.signOut({ scope: "local" });
  return enroll.data.totp.secret;
}

export async function disableAdmin(id: string) {
  await withDb((db) => db.query("UPDATE admin_users SET disabled_at = now() WHERE id = $1", [id]));
}

// A current code, never one about to expire: with under 5 seconds left in the 30 second step,
// it waits for the next step so the server does not see a stale code.
export async function totpCode(secret: string): Promise<string> {
  const remainingMs = 30_000 - (Date.now() % 30_000);
  if (remainingMs < 5_000) await new Promise((resolve) => setTimeout(resolve, remainingMs + 250));
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
}

// Any code but the current one.
export async function wrongCode(secret: string): Promise<string> {
  const right = await totpCode(secret);
  return right === "000000" ? "111111" : "000000";
}

export async function signInWithPassword(page: Page, user: TestUser, next?: string) {
  await page.goto(next ? `/admin/sign-in?next=${encodeURIComponent(next)}` : "/admin/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/mfa/);
}

export async function enterCode(page: Page, code: string, submit = "Verify") {
  await page.getByLabel("6 digit code").fill(code);
  await page.getByRole("button", { name: submit, exact: true }).click();
}

// Password plus TOTP: the admin lands in the panel (aal2).
export async function signInFully(page: Page, user: TestUser) {
  if (!user.secret) throw new Error("signInFully needs an enrolled admin.");
  await signInWithPassword(page, user);
  await enterCode(page, await totpCode(user.secret));
  await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();
}

export async function authCookieNames(page: Page): Promise<string[]> {
  const cookies = await page.context().cookies();
  return cookies.filter((cookie) => cookie.name.startsWith("sb-")).map((cookie) => cookie.name);
}

// The newest email Mailpit holds for this address, waiting for it to arrive.
export async function latestEmailHtml(to: string): Promise<string> {
  let html: string | null = null;
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const body = (await search.json()) as { messages?: { ID: string }[] };
        const id = body.messages?.[0]?.ID;
        if (!id) return false;
        const message = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
        html = ((await message.json()) as { HTML: string }).HTML;
        return true;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  if (html === null) throw new Error(`No email arrived for ${to}.`);
  return html;
}

export function resetLinkFrom(html: string): string {
  const match = html.match(/href="([^"]*\/auth\/confirm\?[^"]*)"/);
  if (!match?.[1]) throw new Error("No reset link in the email.");
  return match[1].replaceAll("&amp;", "&");
}

// A browser session for someone who never passes the sign in form: signs in through
// @supabase/ssr itself and hands its cookies to the page's context.
export async function injectSession(page: Page, user: TestUser) {
  const jar: { name: string; value: string }[] = [];
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => jar,
      setAll(cookies) {
        for (const { name, value } of cookies) {
          const index = jar.findIndex((cookie) => cookie.name === name);
          if (index >= 0) jar.splice(index, 1);
          if (value) jar.push({ name, value });
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw error;
  await page
    .context()
    .addCookies(jar.map((cookie) => ({ ...cookie, domain: "localhost", path: "/" })));
}
