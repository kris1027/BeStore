import { readFlags, run } from "./cli";
import { connect, disableAdmin, noAdminMessage } from "./lib";

// pnpm admin:disable --email <e> [--env-file <path>]
run(async () => {
  const flags = readFlags(["email"]);
  if (!flags.email)
    throw new Error("Usage: pnpm admin:disable --email <email> [--env-file <path>]");
  const deps = connect(flags["env-file"]);
  try {
    const id = await disableAdmin(deps, flags.email);
    if (id === null) throw new Error(noAdminMessage);
    console.log(`Disabled admin ${id}. Their next request gets a 404.`);
  } finally {
    await deps.close();
  }
});
