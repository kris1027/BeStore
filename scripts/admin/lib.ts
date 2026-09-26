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
  // Only used when no auth user has this email yet; an existing user keeps their password.
  readonly password: string | null;
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
    const { error } = await supabase.auth.admin.updateUserById(existingId, { email_confirm: true });
    if (error) throw new Error(`Could not confirm the existing user: ${error.message}`);
    id = existingId;
  } else {
    if (input.password === null) throw new Error("A password is needed for a new user.");
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

export async function disableAdmin({ db }: Pick<AdminDeps, "db">, email: string): Promise<string> {
  const admin = await db.adminUser.findUnique({ where: { email: normalizeEmail(email) } });
  if (!admin) throw new Error("No admin has that email.");
  // Takes effect on their next request: requireAdmin() reads this row every time.
  await db.adminUser.update({ where: { id: admin.id }, data: { disabledAt: new Date() } });
  return admin.id;
}

export async function resetAdminMfa(
  { db, supabase }: AdminDeps,
  email: string,
): Promise<{ readonly id: string; readonly factorsRemoved: number }> {
  const admin = await db.adminUser.findUnique({ where: { email: normalizeEmail(email) } });
  if (!admin) throw new Error("No admin has that email.");

  const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId: admin.id });
  if (error) throw new Error(`Could not list factors: ${error.message}`);
  for (const factor of data.factors) {
    const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: admin.id,
    });
    if (deleteError) throw new Error(`Could not delete a factor: ${deleteError.message}`);
  }

  // Deleting the sessions revokes every refresh token (they cascade), and requireAdmin()'s
  // getUser() finds no session, so every device is out on its next request. The only write to
  // the auth schema anywhere in the app.
  await db.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${admin.id}::uuid`;
  return { id: admin.id, factorsRemoved: data.factors.length };
}
