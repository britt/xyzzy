import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GameState } from "../world/schema.js";
import { slugify } from "../util/slug.js";

/** Thrown when a save cannot be read or fails validation. */
export class SaveLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveLoadError";
  }
}

/**
 * `$XDG_STATE_HOME/xyzzy/<adventure id>/saves` (default
 * `~/.local/state/xyzzy/<adventure id>/saves`) — global, not inside the
 * adventure directory, so saves survive moving/reinstalling the adventure.
 * The id is slugified since it comes from adventure.yaml (untrusted content
 * for a downloaded adventure) and is otherwise unrestricted by the schema —
 * without this a crafted `meta.id` like `../../etc` could escape the saves
 * tree.
 */
function savesDir(adventureId: string): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "xyzzy", slugify(adventureId), "saves");
}

export function savePath(adventureId: string, slot: string): string {
  return join(savesDir(adventureId), `${slot}.json`);
}

/** Whether a save slot exists on disk. */
export function saveExists(adventureId: string, slot: string): boolean {
  return existsSync(savePath(adventureId, slot));
}

/** List known save slot names, sorted alphabetically. */
export function listSaves(adventureId: string): string[] {
  const dir = savesDir(adventureId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/**
 * Persist game state atomically (temp file + rename) to
 * `$XDG_STATE_HOME/xyzzy/<adventure id>/saves/<slot>.json`, so an interrupted
 * write never corrupts an existing save.
 */
export async function saveGame(
  adventureId: string,
  slot: string,
  state: GameState,
): Promise<void> {
  const dir = savesDir(adventureId);
  mkdirSync(dir, { recursive: true });
  const target = savePath(adventureId, slot);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, target);
}

/**
 * Load and validate a save. A corrupt or malformed save is reported via
 * {@link SaveLoadError}, never silently reset.
 */
export async function loadGame(
  adventureId: string,
  slot: string,
): Promise<GameState> {
  const target = savePath(adventureId, slot);
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch {
    throw new SaveLoadError(`No save found: ${target}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveLoadError(`Save file is not valid JSON: ${target}`);
  }

  const parsed = GameState.safeParse(raw);
  if (!parsed.success) {
    throw new SaveLoadError(
      `Save file is corrupt or from an incompatible version: ${target}`,
    );
  }
  return parsed.data;
}
