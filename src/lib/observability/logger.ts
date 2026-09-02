/**
 * Vercel captures stdout as structured logs per-invocation, and the serverless
 * filesystem is ephemeral/read-only outside `/tmp`, so this only ever logs to
 * the console — no `File` transport.
 */
import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  defaultMeta: { service: "benavora" },
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [new transports.Console()],
});

export function logEvent(
  type: string,
  data: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info"
) {
  logger.log(level, { type, ...data });
}
