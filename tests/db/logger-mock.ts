import type { Logger } from "pino";

type LoggerModule = typeof import("@/lib/logger");

// For `vi.mock("@/lib/logger", ...)`. The real createAdminEventLogger defaults to the real
// logger, so a mock that only swaps `logger` would miss every admin event (or, without the
// export at all, fail to load the feature's log.ts). Bind the real factory to the mock instead.
export async function mockLoggerModule(
  importOriginal: () => Promise<LoggerModule>,
  methods: Partial<Record<"info" | "warn" | "error", unknown>>,
) {
  const actual = await importOriginal();
  const logger = methods as unknown as Logger;
  return {
    ...actual,
    logger,
    createAdminEventLogger: <Events extends Record<string, object>>() =>
      actual.createAdminEventLogger<Events>(logger),
  };
}
