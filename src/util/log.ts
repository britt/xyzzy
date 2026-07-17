import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Disk logger. During `play` the Ink TUI owns the terminal, so diagnostics
 * can't go to stdout/stderr — they'd corrupt the render. Everything worth
 * keeping (errors with full provider detail, lifecycle events) is appended as
 * JSON lines to a log file instead. Logging is best-effort and never throws.
 */

/** `$XDG_STATE_HOME/xyzzy` (default `~/.local/state/xyzzy`). */
export function logDir(): string {
  const base =
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "xyzzy");
}

export function logPath(): string {
  return join(logDir(), "xyzzy.log");
}

const AI_SDK_FIELDS = ["statusCode", "url", "responseBody"] as const;

/**
 * Flatten an error into a plain object for logging. Crucially, this captures
 * the AI SDK `APICallError` fields (`statusCode`, `url`, `responseBody`) and
 * the underlying `cause` — the detail that explains a generic message like
 * "Invalid JSON response".
 */
export function describeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { value: String(err) };

  const out: Record<string, unknown> = { name: err.name, message: err.message };
  const anyErr = err as unknown as Record<string, unknown>;
  for (const field of AI_SDK_FIELDS) {
    if (anyErr[field] !== undefined) out[field] = anyErr[field];
  }
  if (anyErr.cause instanceof Error) {
    out.cause = { name: anyErr.cause.name, message: anyErr.cause.message };
  } else if (anyErr.cause !== undefined) {
    out.cause = anyErr.cause;
  }
  if (err.stack) out.stack = err.stack;
  return out;
}

function emit(level: string, message: string, detail?: unknown): void {
  if (process.env.XYZZY_LOG === "0") return;
  const record = {
    time: new Date().toISOString(),
    level,
    message,
    ...(detail !== undefined ? { detail } : {}),
  };
  try {
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(logPath(), `${JSON.stringify(record)}\n`);
  } catch {
    // Never let logging break the app.
  }
}

export const log = {
  info: (message: string, detail?: unknown) => emit("info", message, detail),
  warn: (message: string, detail?: unknown) => emit("warn", message, detail),
  error: (message: string, err?: unknown) =>
    emit("error", message, err === undefined ? undefined : describeError(err)),
};

/**
 * A concise, human-facing one-liner for an error — richer than `err.message`
 * for provider (`APICallError`) failures, which otherwise read as an opaque
 * "Invalid JSON response". Full detail goes to the log.
 */
export function userMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const anyErr = err as unknown as Record<string, unknown>;
  const parts = [err.message];
  if (typeof anyErr.statusCode === "number") parts.push(`HTTP ${anyErr.statusCode}`);
  const cause = anyErr.cause;
  if (cause instanceof Error && cause.message && cause.message !== err.message) {
    parts.push(cause.message);
  }
  return parts.join(" · ");
}
