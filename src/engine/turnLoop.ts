import { Action } from "../world/actions.js";
import type { Adventure, GameState } from "../world/schema.js";
import type { NarratorContext, NarratorModel } from "../llm/NarratorModel.js";
import { buildDigest } from "./digest.js";
import { reduceAll } from "./reducer.js";
import { appendMessage, windowTranscript } from "./transcript.js";

export interface TurnResult {
  narration: string;
  state: GameState;
}

export interface TurnDeps {
  adventure: Adventure;
  model: NarratorModel;
  /** injectable clock for deterministic timestamps in tests */
  clock?: () => string;
  /** number of recent transcript messages to send to the model */
  transcriptWindow?: number;
}

/** Thrown when the model fails to produce any narration, even after a retry. */
export class EmptyNarrationError extends Error {
  constructor() {
    super("Model returned no narration after a retry.");
    this.name = "EmptyNarrationError";
  }
}

const DEFAULT_TRANSCRIPT_WINDOW = 20;

/**
 * Player-facing, authoritative list of the current room's exits and their
 * directions. Returns null when the location is freeform or an improvised room
 * (no authored exits to enumerate), leaving the model's prose to stand.
 */
export function exitsFooter(
  adventure: Adventure,
  state: GameState,
): string | null {
  if (state.location === null) return null;
  const rooms = adventure.entities?.rooms ?? [];
  const room = rooms.find((r) => r.id === state.location);
  if (!room) return null;

  const exits = Object.entries(room.exits ?? {});
  if (exits.length === 0) return "Exits: none — there is no obvious way out.";

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const parts = exits.map(([dir, target]) => {
    const dest = byId.get(target);
    return dest ? `${dir} to ${dest.name}` : dir;
  });
  return `Exits: ${parts.join(", ")}.`;
}

/**
 * Remove any "Exit:"/"Exits: …" run the model emitted (often copied verbatim
 * from the digest, truncated and with internal ids like `[entrance]`). The
 * engine appends its own authoritative exits line, so the model's is redundant
 * and usually wrong.
 */
export function stripProseExits(text: string): string {
  return text.replace(/\s*Exits?:[^\n]*/gi, "").trim();
}

/** System prompt: premise + tone + the rules that steer tool use. */
export function buildSystemPrompt(adventure: Adventure): string {
  return [
    "You are the game master for a text adventure. Narrate the outcome of the",
    "player's actions vividly and in the second person, staying consistent with",
    "the world facts given in the state digest. Voice any characters in scene.",
    "",
    "Mutate game state ONLY through the provided tools (move, take/drop items,",
    "set flags, update characters, advance beats). Do not invent state changes",
    "in prose without also emitting the matching tool call. Keep narration to a",
    "few sentences.",
    "",
    "EXITS: Do NOT list the room's exits yourself. After your narration the game",
    "automatically appends the complete, authoritative list of exits and their",
    "directions, so just describe the scene and never enumerate exits in prose",
    "(listing only some of them would contradict that authoritative list).",
    "",
    "PREMISE:",
    adventure.premise.trim(),
  ].join("\n");
}

/**
 * Run one turn: build model context (system prompt + digest + windowed
 * transcript), call the model with zod-typed tools, fold the resulting
 * validated actions through the pure reducer, append to the transcript, and
 * return narration + next state.
 *
 * State is derived and returned only after actions validate, so a thrown model
 * error leaves the caller's state untouched (clean rollback, no corrupt save).
 * Invalid tool-call args are dropped before the reducer runs (defense-in-depth).
 */
export async function runTurn(
  deps: TurnDeps,
  state: GameState,
  input: string,
): Promise<TurnResult> {
  const { adventure, model } = deps;
  const now = deps.clock ? deps.clock() : new Date().toISOString();
  const window = deps.transcriptWindow ?? DEFAULT_TRANSCRIPT_WINDOW;

  const context: NarratorContext = {
    systemPrompt: buildSystemPrompt(adventure),
    digest: buildDigest(adventure, state),
    transcript: windowTranscript(state.transcript, window),
    input,
  };

  // Call the model; retry once if it produces no narration.
  let result = await model.generate(context);
  if (result.narration.trim() === "") {
    result = await model.generate(context);
    if (result.narration.trim() === "") throw new EmptyNarrationError();
  }

  // Validate tool-call args; drop anything malformed before the reducer.
  const actions = result.actions
    .map((a) => Action.safeParse(a))
    .filter((r) => r.success)
    .map((r) => r.data);

  const nextTurn = state.turn + 1;
  const reduced = reduceAll(state, actions);

  // The engine owns the exits line. Strip any "Exits: …" the model copied from
  // the digest (often truncated and with internal ids), then append the
  // authoritative, complete list so the player always sees every way out.
  const prose = stripProseExits(result.narration);
  const footer = exitsFooter(adventure, reduced);
  const narration = footer
    ? `${prose.trimEnd()}\n\n${footer}`.trim()
    : prose;

  let transcript = appendMessage(reduced.transcript, {
    role: "player",
    text: input,
    turn: nextTurn,
  });
  transcript = appendMessage(transcript, {
    role: "narrator",
    text: narration,
    turn: nextTurn,
  });

  return {
    narration,
    state: { ...reduced, turn: nextTurn, transcript, updatedAt: now },
  };
}
