import { PrismaPg } from "@prisma/adapter-pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { z } from "zod";

import { PrismaClient } from "../../src/generated/prisma/client";

// The admin account scripts (spec 0004): no admin UI exists, so these are the whole account
// lifecycle. They never import server-only app modules; they build their own clients here.

export type AdminDeps = {
  readonly db: PrismaClient;
  // Service role client: it bypasses every Auth rule, so it lives only in these scripts.
  readonly supabase: SupabaseClient;
};

const scriptEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DIRECT_URL: z.string().min(1),
});

// Reads .env.local then .env, or the file given with --env-file (for example one written by
// `vercel env pull` to run against production).
export function connect(envFile: string | undefined): AdminDeps & { close(): Promise<void> } {
  config({ path: envFile ? [envFile] : [".env.local", ".env"], quiet: true });
  const parsed = scriptEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Missing environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DIRECT_URL }) });
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { db, supabase, close: () => db.$disconnect() };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Read only lookup in Supabase's auth schema; Prisma manages nothing there.
export async function findAuthUserId(db: PrismaClient, email: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM auth.users WHERE lower(email) = ${normalizeEmail(email)} LIMIT 1`;
  return rows[0]?.id ?? null;
}

export type CreateAdminInput = {
  readonly email: string;
  readonly name: string;
  // Set for an existing user too (spec 0019, AC-15): public sign up lets anyone create an
  // unconfirmed user with a password they know, and confirming it here must not hand them
  // an admin password.
  readonly password: string;
};

export async function createAdmin(
  { db, supabase }: AdminDeps,
  input: CreateAdminInput,
): Promise<{ readonly id: string; readonly existingUser: boolean }> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const existingId = await findAuthUserId(db, email);

  let id: string;
  if (existingId) {
    // One auth user may be both a customer and an admin (spec 0004).
    const { error } = await supabase.auth.admin.updateUserById(existingId, {
      password: input.password,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not update the existing user: ${error.message}`);
    id = existingId;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not create the user: ${error.message}`);
    id = data.user.id;
  }

  await db.adminUser.upsert({
    where: { id },
    create: { id, email, name },
    update: { email, name, disabledAt: null },
  });
  return { id, existingUser: existingId !== null };
}

export async function findAdminId(db: PrismaClient, email: string): Promise<string> {
  const admin = await db.adminUser.findUnique({ where: { email: normalizeEmail(email) } });
  if (!admin) throw new Error("No admin has that email.");
  return admin.id;
}

export async function disableAdmin({ db }: Pick<AdminDeps, "db">, email: string): Promise<string> {
  const id = await findAdminId(db, email);
  // Takes effect on their next request: requireAdmin() reads this row every time.
  await db.adminUser.update({ where: { id }, data: { disabledAt: new Date() } });
  return id;
}

// The only way to change an admin password without knowing it (spec 0019, AC-7). The same
// lookup as disableAdmin, so the two scripts never disagree about who is an admin, enabled or
// not; the admin API applies Supabase's own password policy and writes its auth audit log.
export async function resetAdminPassword(
  deps: AdminDeps,
  email: string,
  password: string,
): Promise<string> {
  const id = await findAdminId(deps.db, email);
  await setAdminPassword(deps, id, password);
  return id;
}

// For a caller that already holds the id from findAdminId (the CLI looks the admin up before
// prompting, so an unknown email is refused without asking for a password).
export async function setAdminPassword(
  { supabase }: Pick<AdminDeps, "supabase">,
  id: string,
  password: string,
): Promise<void> {
  const { error } = await supabase.auth.admin.updateUserById(id, { password });
  if (error) throw new Error(`Could not set the password: ${error.message}`);
}
