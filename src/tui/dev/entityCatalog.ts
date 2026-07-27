import type { Adventure } from "../../world/schema.js";
import type { EntityKind } from "../../world/entityWriter.js";

export type Category = "config" | "beats" | "characters" | "rooms" | "items";

/** Fixed sidebar order, per the design doc. */
export const CATEGORIES: readonly Category[] = [
  "config",
  "beats",
  "characters",
  "rooms",
  "items",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  config: "Adventure Config",
  beats: "Beats",
  characters: "Characters",
  rooms: "Rooms",
  items: "Items",
};

export interface CatalogEntry {
  kind: EntityKind;
  id: string;
  /** the entity's `name` for room/item/character; its `id` for beat, which has no name field. */
  label: string;
}

/**
 * List a category's entities in the adventure's own definition order
 * (inline `adventure.yaml` entries first, then conventional-directory
 * files — whatever order `loadAdventure` already produced). Returns `[]`
 * for the `config` category, which has no entity list of its own.
 */
export function entriesForCategory(
  adventure: Adventure,
  category: Category,
): CatalogEntry[] {
  switch (category) {
    case "config":
      return [];
    case "beats":
      return (adventure.beats ?? []).map((b) => ({
        kind: "beat" as const,
        id: b.id,
        label: b.id,
      }));
    case "characters":
      return (adventure.entities?.characters ?? []).map((c) => ({
        kind: "character" as const,
        id: c.id,
        label: c.name,
      }));
    case "rooms":
      return (adventure.entities?.rooms ?? []).map((r) => ({
        kind: "room" as const,
        id: r.id,
        label: r.name,
      }));
    case "items":
      return (adventure.entities?.items ?? []).map((i) => ({
        kind: "item" as const,
        id: i.id,
        label: i.name,
      }));
  }
}
