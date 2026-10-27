import { createPrompter, promptAdminPassword, readFlags, run } from "./cli";
import { connect, findAdminId, resetAdminPassword } from "./lib";

// pnpm admin:reset-password --email <e> [--env-file <path>]
run(async () => {
  const flags = readFlags(["email"]);
  if (!flags.email) {
    throw new Error("Usage: pnpm admin:reset-password --email <email> [--env-file <path>]");
  }
  const deps = connect(flags["env-file"]);
  const prompt = createPrompter();
  try {
    // Refuse an unknown email before asking for a password.
    await findAdminId(deps.db, flags.email);
    const password = await promptAdminPassword(prompt);
    await resetAdminPassword(deps, flags.email, password);
    console.log(`Password changed for ${flags.email}.`);
    // Supabase's admin password change deletes every session of the user (pinned by the stack
    // test), so this also cuts off anyone holding a stolen session.
    console.log("Every session they had is signed out.");
  } finally {
    prompt.close();
    await deps.close();
  }
});
