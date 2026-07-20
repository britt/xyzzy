import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { buildMap, buildMapModel } from "../../engine/asciiMap.js";
import { newGameState } from "../../engine/state.js";
import { loadAdventure, resolveAdventureFile } from "../../world/loader.js";

/**
 * Compute the adventure's room layout and write it to `map.yaml` beside
 * `adventure.yaml` — a static cartography artifact derived from the authored
 * rooms/exits, not tied to any particular save. Includes an `ascii` field
 * (the same rendering `/map` shows in-game, seeded with the adventure's
 * starting state) so the layout can be eyeballed without loading the game.
 */
export async function map(path: string): Promise<void> {
  const adventure = await loadAdventure(path);
  const dir = dirname(resolveAdventureFile(path));

  const model = buildMapModel(adventure);
  const ascii = buildMap(adventure, newGameState(adventure, ""));

  const target = join(dir, "map.yaml");
  writeFileSync(target, stringify({ ...model, ascii }), "utf8");
  console.log(`Wrote ${target}`);
}
