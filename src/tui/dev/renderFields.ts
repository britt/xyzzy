import type { Adventure, Character, Item, Room, StoryBeat } from "../../world/schema.js";
import { ENTITY_FIELDS } from "../../world/entityWriter.js";
import type { Category } from "./entityCatalog.js";

/**
 * The content pane's model. Splitting rows by shape — rather than emitting one
 * flat `label: value` string — lets the view give each kind its own treatment:
 * a heading to anchor the entity, prose in an indented block that can breathe,
 * and structural data as a bulleted list instead of a crammed comma-join.
 */
export type FieldRow =
  /**
   * Anchors the pane: what you're looking at, over its id. The entity's kind
   * is deliberately absent — the sidebar's selected category already says it.
   * Omitted entirely for a beat, whose title *is* its id.
   */
  | { kind: "heading"; title: string; subtitle?: string }
  /** A short value that reads well beside its label. */
  | { kind: "scalar"; label: string; value: string; dim: boolean }
  /** Prose (description, persona, premise) shown under its label. */
  | { kind: "block"; label: string; value: string; dim: boolean }
  /** Structural data; an empty list renders as a dim placeholder. */
  | { kind: "list"; label: string; items: string[] };

/** Reuse the `xyzzy new` placeholder copy so a field reads identically whether
 * you're creating it or browsing it unset. */
function placeholderFor(kind: "item" | "character" | "beat", key: string): string {
  return ENTITY_FIELDS[kind].find((f) => f.key === key)!.placeholder;
}

function scalar(label: string, value: string | undefined, placeholder: string): FieldRow {
  return value !== undefined
    ? { kind: "scalar", label, value, dim: false }
    : { kind: "scalar", label, value: placeholder, dim: true };
}

function block(label: string, value: string | undefined, placeholder: string): FieldRow {
  return value !== undefined
    ? { kind: "block", label, value, dim: false }
    : { kind: "block", label, value: placeholder, dim: true };
}

function heading(title: string, subtitle?: string): FieldRow {
  return subtitle === undefined
    ? { kind: "heading", title }
    : { kind: "heading", title, subtitle };
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** The id an action acts on, for a one-line effect summary. */
function effectTarget(effect: Record<string, unknown>): string | undefined {
  for (const key of ["key", "room", "item", "character", "beat", "interaction"]) {
    const value = effect[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function describeEffect(effect: { type: string }): string {
  const target = effectTarget(effect as unknown as Record<string, unknown>);
  return target ? `${effect.type} · ${target}` : effect.type;
}

export function renderRoomFields(room: Room): FieldRow[] {
  return [
    heading(room.name, room.id),
    block("Description", room.description, ""),
    {
      kind: "list",
      label: "Exits",
      items: Object.entries(room.exits ?? {}).map(
        ([direction, target]) => `${direction} → ${target}`,
      ),
    },
  ];
}

export function renderItemFields(item: Item): FieldRow[] {
  return [
    heading(item.name, item.id),
    block("Description", item.description, ""),
    scalar("Location", item.location, placeholderFor("item", "location")),
  ];
}

export function renderCharacterFields(character: Character): FieldRow[] {
  return [
    heading(character.name, character.id),
    block("Persona", character.persona, ""),
    scalar("Location", character.location, placeholderFor("character", "location")),
    { kind: "list", label: "History", items: [...character.history] },
    {
      kind: "list",
      label: "State",
      items: Object.entries(character.state).map(([key, value]) => `${key}: ${value}`),
    },
    {
      kind: "list",
      label: "Beats",
      items: (character.beats ?? []).map((beat) => beat.id),
    },
    {
      kind: "list",
      label: "Interactions",
      items: (character.interactions ?? []).map((interaction) => interaction.id),
    },
  ];
}

export function renderBeatFields(beat: StoryBeat): FieldRow[] {
  return [
    heading(beat.id),
    block("Description", beat.description, ""),
    block("Trigger", beat.trigger, placeholderFor("beat", "trigger")),
    {
      kind: "list",
      label: "Effects",
      items: (beat.effects ?? []).map(describeEffect),
    },
  ];
}

export function renderConfigFields(adventure: Adventure): FieldRow[] {
  const entities = adventure.entities;
  return [
    heading(adventure.meta.title, adventure.meta.id),
    { kind: "scalar", label: "Version", value: adventure.meta.version, dim: false },
    scalar("Author", adventure.meta.author, "<author name>"),
    block("Premise", adventure.premise, ""),
    {
      kind: "list",
      label: "Contents",
      items: [
        plural(entities?.rooms?.length ?? 0, "room"),
        plural(entities?.items?.length ?? 0, "item"),
        plural(entities?.characters?.length ?? 0, "character"),
        plural(adventure.beats?.length ?? 0, "beat"),
      ],
    },
  ];
}

/**
 * Dispatch to the right renderer for an entity-bearing category's entity.
 * `config` and `logs` are excluded: neither has a `CatalogEntry` list, and each
 * has its own renderer (`renderConfigFields`, `renderSessionLogFields`).
 */
export function renderFieldsFor(
  category: Exclude<Category, "config" | "logs">,
  entity: Room | Item | Character | StoryBeat,
): FieldRow[] {
  switch (category) {
    case "rooms":
      return renderRoomFields(entity as Room);
    case "items":
      return renderItemFields(entity as Item);
    case "characters":
      return renderCharacterFields(entity as Character);
    case "beats":
      return renderBeatFields(entity as StoryBeat);
  }
}
