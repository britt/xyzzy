import type { Adventure, Character, Item, Room, StoryBeat } from "../../world/schema.js";
import { ENTITY_FIELDS } from "../../world/entityWriter.js";
import type { Category } from "./entityCatalog.js";

export interface FieldRow {
  label: string;
  value: string;
  /** true when this row is an unset/empty placeholder rather than real data. */
  dim: boolean;
}

/** Reuse the `xyzzy new` placeholder copy so a field reads identically whether
 * you're creating it or browsing it unset. */
function placeholderFor(kind: "item" | "character" | "beat", key: string): string {
  return ENTITY_FIELDS[kind].find((f) => f.key === key)!.placeholder;
}

function scalarRow(
  label: string,
  value: string | undefined,
  placeholder: string,
): FieldRow {
  return value !== undefined
    ? { label, value, dim: false }
    : { label, value: placeholder, dim: true };
}

function listRow(label: string, values: string[]): FieldRow {
  return values.length
    ? { label, value: values.join(", "), dim: false }
    : { label, value: "(none)", dim: true };
}

export function renderRoomFields(room: Room): FieldRow[] {
  const exits = Object.entries(room.exits ?? {});
  return [
    { label: "Name", value: room.name, dim: false },
    { label: "Description", value: room.description, dim: false },
    listRow(
      "Exits",
      exits.map(([dir, target]) => `${dir} -> ${target}`),
    ),
  ];
}

export function renderItemFields(item: Item): FieldRow[] {
  return [
    { label: "Name", value: item.name, dim: false },
    { label: "Description", value: item.description, dim: false },
    scalarRow("Location", item.location, placeholderFor("item", "location")),
  ];
}

export function renderCharacterFields(character: Character): FieldRow[] {
  return [
    { label: "Name", value: character.name, dim: false },
    { label: "Persona", value: character.persona, dim: false },
    scalarRow("Location", character.location, placeholderFor("character", "location")),
    listRow("History", character.history),
    Object.keys(character.state).length
      ? { label: "State", value: JSON.stringify(character.state), dim: false }
      : { label: "State", value: "(none)", dim: true },
    listRow(
      "Beats",
      (character.beats ?? []).map((b) => b.id),
    ),
    listRow(
      "Interactions",
      (character.interactions ?? []).map((i) => i.id),
    ),
  ];
}

export function renderBeatFields(beat: StoryBeat): FieldRow[] {
  return [
    { label: "id", value: beat.id, dim: false },
    { label: "Description", value: beat.description, dim: false },
    scalarRow("Trigger", beat.trigger, placeholderFor("beat", "trigger")),
    beat.effects?.length
      ? { label: "Effects", value: `${beat.effects.length} effect(s)`, dim: false }
      : { label: "Effects", value: "(none)", dim: true },
  ];
}

export function renderConfigFields(adventure: Adventure): FieldRow[] {
  return [
    { label: "Title", value: adventure.meta.title, dim: false },
    { label: "Id", value: adventure.meta.id, dim: false },
    { label: "Version", value: adventure.meta.version, dim: false },
    scalarRow("Author", adventure.meta.author, "<author name>"),
    { label: "Premise", value: adventure.premise, dim: false },
  ];
}

/** Dispatch to the right renderer for a non-config category's entity. */
export function renderFieldsFor(
  category: Exclude<Category, "config">,
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
