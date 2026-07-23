import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { readAdventureFile, resolveAdventureFile } from "./loader.js";

export type EntityKind = "room" | "item" | "character" | "beat";

/** Conventional sibling directory name for each entity kind. */
const KIND_DIR: Record<EntityKind, string> = {
  room: "rooms",
  item: "items",
  character: "characters",
  beat: "beats",
};

export interface EntityFieldSpec {
  key: string;
  label: string;
  placeholder: string;
}

/** Top-level scalar fields a form/CLI flag can supply per entity kind. */
export const ENTITY_FIELDS: Record<EntityKind, EntityFieldSpec[]> = {
  room: [
    {
      key: "description",
      label: "Description",
      placeholder: "<what the player sees when they enter>",
    },
  ],
  item: [
    {
      key: "description",
      label: "Description",
      placeholder: "<what the player sees when they examine it>",
    },
    {
      key: "location",
      label: "Location",
      placeholder: "<room or character id where this item starts>",
    },
  ],
  character: [
    {
      key: "persona",
      label: "Persona",
      placeholder: "<how this character speaks and behaves>",
    },
    {
      key: "location",
      label: "Location",
      placeholder: "<room id where this character starts>",
    },
  ],
  beat: [
    { key: "description", label: "Description", placeholder: "<what happens>" },
    {
      key: "trigger",
      label: "Trigger",
      placeholder: "<trigger notes surfaced to the model>",
    },
  ],
};

/** Structural (array/record) fields per kind, always emitted as commented
 * placeholder YAML — never prompted or accepted via flag. */
const STRUCTURAL_BLOCKS: Record<EntityKind, readonly string[]> = {
  room: ["# exits:", "#   north: <room id>"],
  item: [],
  character: [
    "# history: []",
    "# state: {}",
    "# beats:",
    "#   - id: <beat id>",
    "#     description: <what happens>",
  ],
  beat: [
    "# effects:",
    "#   - type: setGameState",
    "#     key: <flag>",
    "#     value: <value>",
  ],
};

export interface EntityWriteInput {
  kind: EntityKind;
  id: string;
  /** room/item/character only; absent for beat, which has no `name` field. */
  name?: string;
  /** scalar field key -> value, or undefined if the field was skipped. */
  values: Record<string, string | undefined>;
}

/** Render a single `key: value` line with proper YAML scalar escaping. */
function scalarLine(key: string, value: string): string {
  return stringify({ [key]: value }).trimEnd();
}

/**
 * Pure YAML-text renderer: `id`/`name` written plainly, each scalar field
 * spec's value written plainly if supplied or as a commented placeholder if
 * skipped, followed by a trailing commented block of the kind's structural
 * fields.
 */
export function renderEntityYaml(input: EntityWriteInput): string {
  const lines: string[] = [scalarLine("id", input.id)];
  if (input.name !== undefined) lines.push(scalarLine("name", input.name));

  for (const field of ENTITY_FIELDS[input.kind]) {
    const value = input.values[field.key];
    lines.push(
      value !== undefined
        ? scalarLine(field.key, value)
        : `# ${field.key}: ${field.placeholder}`,
    );
  }

  lines.push(...STRUCTURAL_BLOCKS[input.kind]);
  return lines.join("\n") + "\n";
}

/** `<adventureDir>/<kind's pluralized dir>/<id>.yaml`. */
export function entityFilePath(
  adventureDir: string,
  kind: EntityKind,
  id: string,
): string {
  return join(adventureDir, KIND_DIR[kind], `${id}.yaml`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function entitiesOfKind(raw: unknown, kind: EntityKind): unknown[] {
  if (!isRecord(raw)) return [];
  if (kind === "beat") {
    return Array.isArray(raw.beats) ? raw.beats : [];
  }
  const entities = raw.entities;
  if (!isRecord(entities)) return [];
  const list = entities[`${kind}s`];
  return Array.isArray(list) ? list : [];
}

/**
 * Scan the adventure's currently-defined entities of `kind` (inline in
 * `adventure.yaml` or split across the conventional directory) for a
 * matching `id`. Returns a human-readable descriptor of the conflicting
 * entity if found, else `undefined`.
 */
export function findEntityIdConflict(
  adventureDir: string,
  kind: EntityKind,
  id: string,
): string | undefined {
  const raw = readAdventureFile(adventureDir);
  const match = entitiesOfKind(raw, kind).find(
    (entry) => isRecord(entry) && entry.id === id,
  );
  if (!match || !isRecord(match)) return undefined;

  const label = kind === "beat" ? match.description : match.name;
  return typeof label === "string" ? label : `id "${id}"`;
}

function requireAdventureFile(adventureDir: string): void {
  let adventureFile: string;
  try {
    adventureFile = resolveAdventureFile(adventureDir);
  } catch {
    throw new Error(
      `No such adventure at ${adventureDir}. Run \`xyzzy new <name>\` first.`,
    );
  }
  if (!existsSync(adventureFile)) {
    throw new Error(
      `No such adventure at ${adventureDir}. Run \`xyzzy new <name>\` first.`,
    );
  }
}

/**
 * Write a new entity file into `adventureDir`'s conventional kind
 * directory. Refuses to overwrite an existing file at the target path or to
 * write an id that already conflicts with an entity the adventure already
 * defines.
 */
export function writeEntityFile(
  adventureDir: string,
  input: EntityWriteInput,
): { path: string } {
  requireAdventureFile(adventureDir);

  const path = entityFilePath(adventureDir, input.kind, input.id);
  if (existsSync(path)) {
    throw new Error(`File already exists, refusing to overwrite: ${path}`);
  }

  const conflict = findEntityIdConflict(adventureDir, input.kind, input.id);
  if (conflict !== undefined) {
    throw new Error(
      `A ${input.kind} with id "${input.id}" already exists (${conflict}).`,
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderEntityYaml(input), "utf8");
  return { path };
}
