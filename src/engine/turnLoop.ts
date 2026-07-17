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
    "EXITS: Whenever you describe a room — on entering it, when the player looks",
    "around, or when first introducing it — you MUST end the description by",
    'explicitly listing every available exit with its direction, e.g. "Exits:',
    'north to the hallway, east to a dark alcove." Take the exits from the state',
    "digest's Exits line when it lists them; never omit or contradict them. If a",
    "room genuinely has no exits, say there are no obvious ways out.",
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
  let transcript = appendMessage(reduced.transcript, {
    role: "player",
    text: input,
    turn: nextTurn,
  });
  transcript = appendMessage(transcript, {
    role: "narrator",
    text: result.narration,
    turn: nextTurn,
  });

  return {
    narration: result.narration,
    state: { ...reduced, turn: nextTurn, transcript, updatedAt: now },
  };
}
