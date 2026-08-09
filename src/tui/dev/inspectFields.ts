import type {
  Adventure,
  Character,
  GameState,
  LiveCharacter,
} from "../../world/schema.js";
import type { CatalogEntry, Category } from "./entityCatalog.js";
import type { FieldRow } from "./renderFields.js";

/**
 * The runtime counterpart to `renderFields.ts`: while a play session is
 * live, the sidebar stops showing an entity's authored definition and shows
 * what the running `GameState` actually has for it instead — the exact
 * fields the reducer records (`src/engine/reducer.ts`), not what was
 * authored. Authored values are shown alongside the live one only where
 * doing so surfaces drift (a character's authored vs. current location).
 */

function heading(title: string, subtitle?: string): FieldRow {
  return subtitle === undefined
    ? { kind: "heading", title }
    : { kind: "heading", title, subtitle };
}

function boolScalar(label: string, value: boolean): FieldRow {
  return { kind: "scalar", label, value: value ? "yes" : "no", dim: false };
}

function entries(bag: Record<string, unknown>): string[] {
  return Object.entries(bag).map(([key, value]) => `${key}: ${String(value)}`);
}

const BEAT_FLAG = /^beat:(.+)$/;
const INTERACTION_COUNT = /^interaction:(.+):count$/;

function firedBeats(live: LiveCharacter | undefined): string[] {
  return Object.entries(live?.state ?? {})
    .filter(([, value]) => value === "advanced")
    .map(([key]) => key.match(BEAT_FLAG)?.[1])
    .filter((id): id is string => id !== undefined);
}

function interactionCounts(live: LiveCharacter | undefined): string[] {
  return Object.entries(live?.state ?? {})
    .map(([key, value]) => {
      const id = key.match(INTERACTION_COUNT)?.[1];
      return id === undefined ? undefined : `${id}: ${String(value)}`;
    })
    .filter((entry): entry is string => entry !== undefined);
}

/** The player's location, contrasted with an authored value when they differ. */
function locationRow(authored: string | undefined, live: string | undefined): FieldRow {
  if (live === undefined) {
    return authored !== undefined
      ? { kind: "scalar", label: "Location", value: authored, dim: false }
      : { kind: "scalar", label: "Location", value: "(nowhere)", dim: true };
  }
  const value = authored !== undefined && authored !== live ? `${live} (authored: ${authored})` : live;
  return { kind: "scalar", label: "Location", value, dim: false };
}

export function inspectGameStateFields(state: GameState | null): FieldRow[] {
  if (!state) {
    return [
      heading("Game State"),
      { kind: "block", label: "Status", value: "(no session running)", dim: true },
    ];
  }

  return [
    heading("Game State", `turn ${state.turn}`),
    locationRow(undefined, state.location ?? undefined),
    { kind: "list", label: "Inventory", items: [...state.inventory] },
    { kind: "list", label: "Flags", items: entries(state.flags) },
    { kind: "list", label: "State", items: entries(state.state) },
    {
      kind: "list",
      label: "Characters",
      items: Object.entries(state.characters).map(
        ([id, live]) => `${id}: ${live.location ?? "(nowhere)"}`,
      ),
    },
  ];
}

export function inspectRoomFields(
  adventure: Adventure,
  state: GameState,
  roomId: string,
): FieldRow[] {
  const room = adventure.entities?.rooms?.find((r) => r.id === roomId);
  const charactersHere = Object.entries(state.characters)
    .filter(([, live]) => live.location === roomId)
    .map(([id]) => id);
  const itemsHere = (adventure.entities?.items ?? [])
    .filter((item) => item.location === roomId)
    .map((item) => item.name);

  return [
    room ? heading(room.name, room.id) : heading(roomId),
    boolScalar("Player here", state.location === roomId),
    { kind: "list", label: "Characters here", items: charactersHere },
    { kind: "list", label: "Items here (authored)", items: itemsHere },
  ];
}

export function inspectCharacterFields(
  adventure: Adventure,
  state: GameState,
  characterId: string,
): FieldRow[] {
  const character: Character | undefined = adventure.entities?.characters?.find(
    (c) => c.id === characterId,
  );
  const live = state.characters[characterId];

  return [
    character ? heading(character.name, character.id) : heading(characterId),
    locationRow(character?.location, live?.location),
    { kind: "list", label: "History", items: [...(live?.history ?? [])] },
    { kind: "list", label: "Fired beats", items: firedBeats(live) },
    { kind: "list", label: "Interaction counts", items: interactionCounts(live) },
  ];
}

export function inspectBeatFields(
  adventure: Adventure,
  state: GameState,
  beatId: string,
): FieldRow[] {
  const fired = state.flags[`beat:${beatId}`] === "advanced";
  return [heading(beatId), boolScalar("Fired", fired)];
}

export function inspectItemFields(
  adventure: Adventure,
  state: GameState,
  itemId: string,
): FieldRow[] {
  const item = adventure.entities?.items?.find((i) => i.id === itemId);
  const inInventory = state.inventory.includes(itemId);
  const location: FieldRow = inInventory
    ? { kind: "scalar", label: "Location", value: "in inventory", dim: false }
    : item?.location !== undefined
      ? { kind: "scalar", label: "Location", value: item.location, dim: false }
      : { kind: "scalar", label: "Location", value: "(unplaced)", dim: true };

  return [item ? heading(item.name, item.id) : heading(itemId), location];
}

/**
 * Dispatch to the right inspector for an entity-bearing category's entity.
 * Mirrors `renderFieldsFor`'s shape, but reads live `GameState` instead of
 * the authored entity.
 */
export function inspectFieldsFor(
  category: Exclude<Category, "config" | "gamestate" | "logs">,
  adventure: Adventure,
  state: GameState,
  entry: CatalogEntry,
): FieldRow[] {
  switch (category) {
    case "rooms":
      return inspectRoomFields(adventure, state, entry.id);
    case "items":
      return inspectItemFields(adventure, state, entry.id);
    case "characters":
      return inspectCharacterFields(adventure, state, entry.id);
    case "beats":
      return inspectBeatFields(adventure, state, entry.id);
  }
}
