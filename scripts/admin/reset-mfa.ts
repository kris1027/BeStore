import { readFlags, run } from "./cli";
import { connect, resetAdminMfa } from "./lib";

// pnpm admin:reset-mfa --email <e> [--env-file <path>]
run(async () => {
  const flags = readFlags(["email"]);
  if (!flags.email) {
    throw new Error("Usage: pnpm admin:reset-mfa --email <email> [--env-file <path>]");
  }
  const deps = connect(flags["env-file"]);
  try {
    const { id, factorsRemoved } = await resetAdminMfa(deps, flags.email);
    console.log(
      `Removed ${factorsRemoved} factor(s) and every session for admin ${id}. ` +
        "They set up their authenticator again at their next sign in.",
    );
  } finally {
    await deps.close();
  }
});
