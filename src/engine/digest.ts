import type { Adventure, GameState } from "../world/schema.js";
import { notImplemented } from "../util/notImplemented.js";

/**
 * Build the compact, authoritative "state digest" fed to the model each turn:
 * current room + visible entities, inventory, relevant character
 * `state`/`history`, and active beats. Regenerated from {@link GameState} every
 * turn so the transcript can be windowed without losing game facts.
 *
 * TODO: render current room, exits, present items/characters, inventory,
 * active beats into a token-efficient string.
 */
export function buildDigest(_adventure: Adventure, _state: GameState): string {
  return notImplemented("engine/digest.buildDigest");
}
