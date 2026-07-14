import type { Adventure, GameState } from "../world/schema.js";
import { notImplemented } from "../util/notImplemented.js";

/**
 * Seed a fresh {@link GameState} from an adventure's `start` block and entity
 * definitions (characters copied into their live runtime form). Timestamps are
 * injected by the caller to keep this deterministic where possible.
 *
 * TODO: map start.room/inventory/flags/state, seed live characters from
 * entities.characters, set turn=0 and an empty transcript.
 */
export function newGameState(
  _adventure: Adventure,
  _now: string,
): GameState {
  return notImplemented("engine/state.newGameState");
}
