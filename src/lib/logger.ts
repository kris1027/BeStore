import pino from "pino";

// Keys that must never reach a log line, at any depth (spec 0004, AC-13). pino's redact paths
// match one level per `*`, so each key is listed at the top level and under a few wildcards.
export const redactedKeys = [
  "password",
  "code",
  "secret",
  "token",
  "token_hash",
  "cookie",
  "authorization",
] as const;

const depths = ["", "*.", "*.*.", "*.*.*.", "*.*.*.*."] as const;

export const redactPaths: readonly string[] = depths.flatMap((prefix) =>
  redactedKeys.map((key) => `${prefix}${key}`),
);

// JSON to stdout, which Vercel captures. Pass a destination only in tests.
export function createLogger(destination?: pino.DestinationStream) {
  const options: pino.LoggerOptions = {
    level: "info",
    redact: { paths: [...redactPaths], censor: "[redacted]" },
    base: undefined,
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

// A typed `info` logger for admin events: each feature passes its own event map (event name to
// its fields), and every entry carries the acting admin's id.
export function createAdminEventLogger<Events extends Record<string, object>>(
  log: pino.Logger = logger,
) {
  return <E extends keyof Events & string>(
    event: E,
    fields: { readonly adminId: string } & Events[E],
  ): void => {
    // Widened to a plain record: pino's message overloads cannot resolve a generic object type.
    const entry: Record<string, unknown> = { event, ...fields };
    log.info(entry, event);
  };
}
