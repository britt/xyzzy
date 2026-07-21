import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GameState } from "../world/schema.js";

/** Thrown when a save cannot be read or fails validation. */
export class SaveLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveLoadError";
  }
}

function savesDir(adventureDir: string): string {
  return join(adventureDir, "saves");
}

export function savePath(adventureDir: string, slot: string): string {
  return join(savesDir(adventureDir), `${slot}.json`);
}

/** Whether a save slot exists on disk. */
export function saveExists(adventureDir: string, slot: string): boolean {
  return existsSync(savePath(adventureDir, slot));
}

/** List known save slot names, sorted alphabetically. */
export function listSaves(adventureDir: string): string[] {
  const dir = savesDir(adventureDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/**
 * Persist game state atomically (temp file + rename) to
 * `<adventureDir>/saves/<slot>.json`, so an interrupted write never corrupts an
 * existing save.
 */
export async function saveGame(
  adventureDir: string,
  slot: string,
  state: GameState,
): Promise<void> {
  const dir = savesDir(adventureDir);
  mkdirSync(dir, { recursive: true });
  const target = savePath(adventureDir, slot);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, target);
}

/**
 * Load and validate a save. A corrupt or malformed save is reported via
 * {@link SaveLoadError}, never silently reset.
 */
export async function loadGame(
  adventureDir: string,
  slot: string,
): Promise<GameState> {
  const target = savePath(adventureDir, slot);
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
