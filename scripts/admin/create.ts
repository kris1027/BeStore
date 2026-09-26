import { passwordSchema } from "../../src/features/admin-auth/schemas";
import { createPrompter, readFlags, run } from "./cli";
import { connect, createAdmin, findAuthUserId } from "./lib";

// pnpm admin:create --email <e> --name <n> [--env-file <path>]
run(async () => {
  const flags = readFlags(["email", "name"]);
  if (!flags.email || !flags.name) {
    throw new Error("Usage: pnpm admin:create --email <email> --name <name> [--env-file <path>]");
  }
  const deps = connect(flags["env-file"]);
  const prompt = createPrompter();
  try {
    const existing = await findAuthUserId(deps.db, flags.email);
    let password: string | null = null;
    if (existing) {
      console.log("A user with this email already exists; they keep their current password.");
    } else {
      password = await prompt.hidden("Password: ");
      const check = passwordSchema.safeParse(password);
      if (!check.success) {
        throw new Error(
          `The password needs:\n${check.error.issues.map((i) => `- ${i.message}`).join("\n")}`,
        );
      }
      if ((await prompt.hidden("Password again: ")) !== password) {
        throw new Error("The passwords do not match.");
      }
    }
    const { id } = await createAdmin(deps, { email: flags.email, name: flags.name, password });
    console.log(`Admin ready: ${id}`);
    console.log("They set up their authenticator app at their first sign in.");
  } finally {
    prompt.close();
    await deps.close();
  }
});
