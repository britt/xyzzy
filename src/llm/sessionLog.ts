import { homedir } from "node:os";
import { join } from "node:path";
import { slugify } from "../util/slug.js";

/**
 * Per-session record of every LLM call a play session makes, written as JSON
 * lines so a long session can be appended to cheaply and read back a line at a
 * time. One file per session: a `session` header line, then one `turn` line per
 * completed turn.
 */

/** Which entry point started the session. */
export type SessionSource = "dev" | "play";

export interface SessionHeader {
  type: "session";
  startedAt: string;
  adventure: string;
  source: SessionSource;
  provider: { kind: string; baseURL?: string; model: string };
  saveSlot: string;
  resumedFrom: string | null;
}

/** One LLM call: what went in, how long it took, and what came back (or failed). */
export type CallLog<Ctx, Res> =
  | { context: Ctx; ms: number; ok: true; result: Res }
  | { context: Ctx; ms: number; ok: false; error: Record<string, unknown> };

export interface TurnRecord<DetectorCall = unknown, NarratorCall = unknown> {
  type: "turn";
  turn: number;
  input: string;
  detector: DetectorCall[];
  narrator: NarratorCall[];
}

/**
 * `$XDG_STATE_HOME/xyzzy/<slug>/logs` — mirrors `savesDir` in
 * `engine/save.ts` exactly (same base-dir resolution, same slugify + hex
 * fallback for an id that collapses to nothing), just under `logs` instead
 * of `saves`.
 */
function sessionLogDir(adventureId: string): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const slug =
    slugify(adventureId) || Buffer.from(adventureId, "utf8").toString("hex");
  return join(base, "xyzzy", slug, "logs");
}

export function sessionLogPath(adventureId: string, sessionId: string): string {
  return join(sessionLogDir(adventureId), `${sessionId}.jsonl`);
}
