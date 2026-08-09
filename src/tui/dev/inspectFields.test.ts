import { describe, expect, it } from "vitest";
import {
  inspectGameStateFields,
  inspectRoomFields,
  inspectCharacterFields,
  inspectBeatFields,
  inspectItemFields,
  inspectFieldsFor,
} from "./inspectFields.js";
import type { Adventure, GameState } from "../../world/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: { room: "cavern" },
  entities: {
    rooms: [
      { id: "cavern", name: "Cavern", description: "d" },
      { id: "hall", name: "Hall", description: "d2" },
    ],
    items: [
      { id: "key", name: "Key", description: "d", location: "cavern" },
      { id: "torch", name: "Torch", description: "d" },
    ],
    characters: [
      { id: "hermit", name: "Hermit", persona: "p", location: "cavern", history: [], state: {} },
    ],
  },
  beats: [{ id: "won-the-key", description: "d" }],
};

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    adventureId: "a",
    adventureVersion: "1",
    location: "cavern",
    inventory: [],
    flags: {},
    state: {},
    characters: { hermit: { location: "cavern", history: [], state: {} } },
    turn: 0,
    transcript: [],
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  };
}

describe("inspectGameStateFields", () => {
  it("shows a placeholder status when no session is running", () => {
    expect(inspectGameStateFields(null)).toEqual([
      { kind: "heading", title: "Game State" },
      { kind: "block", label: "Status", value: "(no session running)", dim: true },
    ]);
  });

  it("dumps location, turn, inventory, flags, state, and characters", () => {
    const s = state({
      location: "hall",
      turn: 3,
      inventory: ["key"],
      flags: { "beat:won-the-key": "advanced" },
      state: { mood: "tense" },
      characters: { hermit: { location: "hall", history: ["met"], state: {} } },
    });
    const rows = inspectGameStateFields(s);
    expect(rows[0]).toEqual({ kind: "heading", title: "Game State", subtitle: "turn 3" });
    expect(rows).toContainEqual({ kind: "scalar", label: "Location", value: "hall", dim: false });
    expect(rows).toContainEqual({ kind: "list", label: "Inventory", items: ["key"] });
    expect(rows).toContainEqual({
      kind: "list",
      label: "Flags",
      items: ["beat:won-the-key: advanced"],
    });
    expect(rows).toContainEqual({ kind: "list", label: "State", items: ["mood: tense"] });
    expect(rows).toContainEqual({ kind: "list", label: "Characters", items: ["hermit: hall"] });
  });

  it("shows a placeholder location when the player has no location", () => {
    const rows = inspectGameStateFields(state({ location: null }));
    expect(rows).toContainEqual({
      kind: "scalar",
      label: "Location",
      value: "(nowhere)",
      dim: true,
    });
  });
});

describe("inspectRoomFields", () => {
  it("reports the player is not here, no characters here, and authored items here", () => {
    const rows = inspectRoomFields(adventure, state({ location: "hall", characters: {} }), "cavern");
    expect(rows[0]).toEqual({ kind: "heading", title: "Cavern", subtitle: "cavern" });
    expect(rows).toContainEqual({ kind: "scalar", label: "Player here", value: "no", dim: false });
    expect(rows).toContainEqual({ kind: "list", label: "Characters here", items: [] });
    expect(rows).toContainEqual({
      kind: "list",
      label: "Items here (authored)",
      items: ["Key"],
    });
  });

  it("reports the player and characters present when they are here", () => {
    const rows = inspectRoomFields(
      adventure,
      state({
        location: "cavern",
        characters: { hermit: { location: "cavern", history: [], state: {} } },
      }),
      "cavern",
    );
    expect(rows).toContainEqual({ kind: "scalar", label: "Player here", value: "yes", dim: false });
    expect(rows).toContainEqual({ kind: "list", label: "Characters here", items: ["hermit"] });
  });

  it("falls back to the room id as the heading title when the room is unknown", () => {
    const rows = inspectRoomFields(adventure, state(), "nowhere");
    expect(rows[0]).toEqual({ kind: "heading", title: "nowhere" });
  });
});

describe("inspectCharacterFields", () => {
  it("shows the live location plainly when it matches the authored one", () => {
    const rows = inspectCharacterFields(adventure, state(), "hermit");
    expect(rows[0]).toEqual({ kind: "heading", title: "Hermit", subtitle: "hermit" });
    expect(rows).toContainEqual({ kind: "scalar", label: "Location", value: "cavern", dim: false });
  });

  it("contrasts the live location with the authored one when they differ", () => {
    const rows = inspectCharacterFields(
      adventure,
      state({ characters: { hermit: { location: "hall", history: [], state: {} } } }),
      "hermit",
    );
    expect(rows).toContainEqual({
      kind: "scalar",
      label: "Location",
      value: "hall (authored: cavern)",
      dim: false,
    });
  });

  it("lists history, fired beats, and interaction counts from live state", () => {
    const rows = inspectCharacterFields(
      adventure,
      state({
        characters: {
          hermit: {
            location: "cavern",
            history: ["Met the player"],
            state: { "beat:confess": "advanced", "interaction:haggle:count": 2 },
          },
        },
      }),
      "hermit",
    );
    expect(rows).toContainEqual({ kind: "list", label: "History", items: ["Met the player"] });
    expect(rows).toContainEqual({ kind: "list", label: "Fired beats", items: ["confess"] });
    expect(rows).toContainEqual({
      kind: "list",
      label: "Interaction counts",
      items: ["haggle: 2"],
    });
  });

  it("falls back gracefully for a character with no live entry yet", () => {
    const rows = inspectCharacterFields(adventure, state({ characters: {} }), "hermit");
    expect(rows).toContainEqual({ kind: "scalar", label: "Location", value: "cavern", dim: false });
    expect(rows).toContainEqual({ kind: "list", label: "History", items: [] });
  });
});

describe("inspectBeatFields", () => {
  it("reports a beat that has not fired", () => {
    expect(inspectBeatFields(adventure, state(), "won-the-key")).toEqual([
      { kind: "heading", title: "won-the-key" },
      { kind: "scalar", label: "Fired", value: "no", dim: false },
    ]);
  });

  it("reports a beat that has fired", () => {
    const rows = inspectBeatFields(
      adventure,
      state({ flags: { "beat:won-the-key": "advanced" } }),
      "won-the-key",
    );
    expect(rows).toContainEqual({ kind: "scalar", label: "Fired", value: "yes", dim: false });
  });
});

describe("inspectItemFields", () => {
  it("reports an item in inventory", () => {
    const rows = inspectItemFields(adventure, state({ inventory: ["key"] }), "key");
    expect(rows[0]).toEqual({ kind: "heading", title: "Key", subtitle: "key" });
    expect(rows).toContainEqual({
      kind: "scalar",
      label: "Location",
      value: "in inventory",
      dim: false,
    });
  });

  it("falls back to the authored location when not in inventory", () => {
    const rows = inspectItemFields(adventure, state({ inventory: [] }), "key");
    expect(rows).toContainEqual({ kind: "scalar", label: "Location", value: "cavern", dim: false });
  });

  it("shows a placeholder when the item has no authored location and isn't carried", () => {
    const rows = inspectItemFields(adventure, state({ inventory: [] }), "torch");
    expect(rows).toContainEqual({
      kind: "scalar",
      label: "Location",
      value: "(unplaced)",
      dim: true,
    });
  });
});

describe("inspectFieldsFor", () => {
  it("dispatches to the right inspector by category", () => {
    const s = state();
    expect(
      inspectFieldsFor("rooms", adventure, s, { kind: "room", id: "cavern", label: "Cavern" })[0],
    ).toEqual({ kind: "heading", title: "Cavern", subtitle: "cavern" });
    expect(
      inspectFieldsFor("beats", adventure, s, {
        kind: "beat",
        id: "won-the-key",
        label: "won-the-key",
      })[0],
    ).toEqual({ kind: "heading", title: "won-the-key" });
    expect(
      inspectFieldsFor("items", adventure, s, { kind: "item", id: "key", label: "Key" })[0],
    ).toEqual({ kind: "heading", title: "Key", subtitle: "key" });
    expect(
      inspectFieldsFor("characters", adventure, s, {
        kind: "character",
        id: "hermit",
        label: "Hermit",
      })[0],
    ).toEqual({ kind: "heading", title: "Hermit", subtitle: "hermit" });
  });
});
