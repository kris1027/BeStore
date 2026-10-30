import { createPrompter, promptAdminPassword, readFlags, run } from "./cli";
import { connect, createAdmin } from "./lib";

// pnpm admin:create --email <e> --name <n> [--env-file <path>]
run(async () => {
  const flags = readFlags(["email", "name"]);
  if (!flags.email || !flags.name) {
    throw new Error("Usage: pnpm admin:create --email <email> --name <name> [--env-file <path>]");
  }
  const deps = connect(flags["env-file"]);
  const prompt = createPrompter();
  try {
    const password = await promptAdminPassword(prompt);
    const { id } = await createAdmin(deps, { email: flags.email, name: flags.name, password });
    console.log(`Admin ready: ${id}`);
    console.log("They sign in with the password you set.");
  } finally {
    prompt.close();
    await deps.close();
  }
});
