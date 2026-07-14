import type { GameState } from "../world/schema.js";
import { notImplemented } from "../util/notImplemented.js";

/**
 * Persist game state atomically (temp file + rename) to
 * `<adventure>/saves/<slot>.json`.
 *
 * TODO: serialize, write temp, fsync, rename.
 */
export async function saveGame(
  _adventureDir: string,
  _slot: string,
  _state: GameState,
): Promise<void> {
  return notImplemented("engine/save.saveGame");
}

/**
 * Load and validate a save. A corrupt or version-mismatched save is reported,
 * never silently reset.
 *
 * TODO: read file, `GameState.parse`, version check against adventure.
 */
export async function loadGame(
  _adventureDir: string,
  _slot: string,
): Promise<GameState> {
  return notImplemented("engine/save.loadGame");
}
