import { config } from "../config.ts";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function log(level: Level, message: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[config.LOG_LEVEL]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(data && { data }),
  };

  const out = JSON.stringify(entry);

  if (level === "error") {
    console.error(out);
  } else if (level === "warn") {
    console.warn(out);
  } else {
    console.log(out);
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
