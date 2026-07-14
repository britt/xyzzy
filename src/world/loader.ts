import type { Adventure } from "./schema.js";
import { notImplemented } from "../util/notImplemented.js";

/**
 * Read an adventure directory (or `adventure.yaml`) from disk, parse the YAML,
 * and validate it against the {@link Adventure} schema. Throws a readable error
 * on parse/validation failure.
 *
 * TODO: read file, parse YAML (`yaml`), `Adventure.parse`, resolve prose refs.
 */
export async function loadAdventure(_path: string): Promise<Adventure> {
  return notImplemented("world/loader.loadAdventure");
}
