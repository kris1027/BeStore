const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"]);

// The seed writes demo products; against a deployed database that would put fake products
// in a real store. It only runs against a local host unless `--yes` says the target is intended.
export function seedRefusal(
  databaseUrl: string | undefined,
  args: readonly string[],
): string | null {
  if (!databaseUrl) return "DIRECT_URL is not set.";
  if (args.includes("--yes")) return null;
  const host = new URL(databaseUrl).hostname;
  if (LOCAL_HOSTS.has(host)) return null;
  return `Refusing to seed ${host}: it is not a local database. Run \`pnpm db:seed -- --yes\` if you really mean it.`;
}
