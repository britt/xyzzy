import type { Adventure, GameState } from "../world/schema.js";
import type { NarratorModel } from "../llm/NarratorModel.js";
import { notImplemented } from "../util/notImplemented.js";

export interface TurnResult {
  narration: string;
  state: GameState;
}

export interface TurnDeps {
  adventure: Adventure;
  model: NarratorModel;
}

/**
 * Run one turn: build model context (system prompt + digest + windowed
 * transcript), call the model with zod-typed tools, fold the resulting
 * validated actions through the reducer, append transcript, and return
 * narration + next state.
 *
 * State commits only after tool-calls validate, so a failed call rolls the turn
 * back cleanly (no corrupt save).
 *
 * TODO: assemble context, model.generate, validate tool-calls, reduceAll,
 * transcript append, timestamp bump.
 */
export async function runTurn(
  _deps: TurnDeps,
  _state: GameState,
  _input: string,
): Promise<TurnResult> {
  return notImplemented("engine/turnLoop.runTurn");
}
