import { stringify } from "yaml";

export type EntityKind = "room" | "item" | "character" | "beat";

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
