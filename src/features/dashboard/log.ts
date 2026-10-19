import { pgErrorCode } from "@/lib/db-errors";
import { logger } from "@/lib/logger";

// spec 0015, Security model: the period, the window's day count, the duration and the SQLSTATE.
// Never row data, and never the Postgres message, which can quote a row.

export type DashboardLogFields = {
  // A preset, or "custom".
  readonly period: string;
  readonly days: number;
};

export function logDashboardQueryFailed(fields: DashboardLogFields, error: unknown) {
  logger.error(
    { event: "dashboard.query_failed", ...fields, code: pgErrorCode(error) },
    "dashboard.query_failed",
  );
}

export function logDashboardSlow(fields: DashboardLogFields, durationMs: number) {
  logger.warn({ event: "dashboard.slow", ...fields, durationMs }, "dashboard.slow");
}
