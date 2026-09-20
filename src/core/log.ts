/**
 * Minimal dependency-free logger. All diagnostics go to stderr so stdout
 * stays a clean JSON-RPC channel for the MCP stdio transport.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let currentLevel: LogLevel = "warn";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function emit(level: Exclude<LogLevel, "silent">, message: string): void {
  if (ORDER[level] > ORDER[currentLevel]) return;
  const line = `[jev:${level}] ${message}`;
  process.stderr.write(line + "\n");
}

export const log = {
  error: (msg: string) => emit("error", msg),
  warn: (msg: string) => emit("warn", msg),
  info: (msg: string) => emit("info", msg),
  debug: (msg: string) => emit("debug", msg),
};
