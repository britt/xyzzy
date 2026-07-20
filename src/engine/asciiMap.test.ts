import { describe, expect, it } from "vitest";
import { buildMap, buildMapModel } from "./asciiMap.js";
import { newGameState } from "./state.js";
import type { Adventure } from "../world/schema.js";

const adventure: Adventure = {
  meta: { id: "cave", title: "Cave of Echoes", version: "1" },
  premise: "p",
  start: { room: "entrance" },
  entities: {
    rooms: [
      { id: "entrance", name: "Cave Mouth", description: "d", exits: { down: "cavern" } },
      {
        id: "cavern",
        name: "Great Cavern",
        description: "d",
        exits: { up: "entrance", north: "lake", east: "alcove" },
      },
      { id: "lake", name: "Still Lake", description: "d", exits: { south: "cavern" } },
      { id: "alcove", name: "Treasure Alcove", description: "d", exits: { west: "cavern" } },
    ],
    characters: [
      {
        id: "grimble",
        name: "Grimble",
        persona: "a troll",
        location: "lake",
        history: [],
        state: {},
      },
    ],
  },
};

describe("buildMap", () => {
  it("places rooms on a grid and draws connectors between them", () => {
    const state = newGameState(adventure, "now");
    const map = buildMap(adventure, { ...state, location: "cavern" });

    expect(map).toContain("Great Cavern");
    expect(map).toContain("Cave Mouth");
    expect(map).toContain("Still Lake");
    expect(map).toContain("Treasure Alcove");
    // horizontal connector between cavern and alcove
    expect(map).toMatch(/Great Cavern.*-+.*Treasure Alcove/);
    // vertical connector line exists between the entrance/cavern/lake column
    expect(map).toMatch(/\|/);
  });

  it("marks the player's current room with @", () => {
    const state = newGameState(adventure, "now");
    const map = buildMap(adventure, { ...state, location: "alcove" });
    expect(map).toContain("Treasure Alcove @");
  });

  it("shows characters in whichever room they currently occupy", () => {
    const state = newGameState(adventure, "now");
    const map = buildMap(adventure, state);
    expect(map).toContain("Still Lake (Grimble)");
  });

  it("reflects a character's live location override, not just the authored one", () => {
    const state = newGameState(adventure, "now");
    const moved = {
      ...state,
      characters: { ...state.characters, grimble: { location: "alcove", history: [], state: {} } },
    };
    const map = buildMap(adventure, moved);
    expect(map).toContain("Treasure Alcove (Grimble)");
    expect(map).not.toContain("Still Lake (Grimble)");
  });

  it("lists non-spatial exits in a legend instead of drawing them", () => {
    const withDoor: Adventure = {
      ...adventure,
      entities: {
        ...adventure.entities,
        rooms: [
          ...adventure.entities!.rooms!,
          { id: "vault", name: "Hidden Vault", description: "d", exits: { west: "alcove" } },
        ].map((r) =>
          r.id === "alcove" ? { ...r, exits: { ...r.exits, "a brass door": "vault" } } : r,
        ),
      },
    };
    const state = newGameState(withDoor, "now");
    const map = buildMap(withDoor, state);
    expect(map).toContain("Other connections:");
    expect(map).toContain("Treasure Alcove --a brass door--> Hidden Vault");
  });

  it("reports rooms unreachable by any directional exit", () => {
    const withIsland: Adventure = {
      ...adventure,
      entities: {
        ...adventure.entities,
        rooms: [
          ...adventure.entities!.rooms!,
          { id: "island", name: "Floating Island", description: "d" },
        ],
      },
    };
    const state = newGameState(withIsland, "now");
    const map = buildMap(withIsland, state);
    expect(map).toContain("Other rooms (no direct path from here):");
    expect(map).toContain("Floating Island");
  });

  it("handles adventures with no authored rooms", () => {
    const bare: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    const state = newGameState(bare, "now");
    expect(buildMap(bare, state)).toBe("No rooms authored for this adventure.");
  });
});

describe("buildMapModel", () => {
  it("pairs every room's authored exits with its computed grid position", () => {
    const model = buildMapModel(adventure);
    expect(model.title).toBe("Cave of Echoes");
    expect(model.rooms).toHaveLength(4);

    const cavern = model.rooms.find((r) => r.id === "cavern")!;
    expect(cavern.exits).toEqual({ up: "entrance", north: "lake", east: "alcove" });
    expect(cavern.level).toBe(1); // one level down from the start room

    const entrance = model.rooms.find((r) => r.id === "entrance")!;
    expect(entrance.level).toBe(0); // the start room anchors level 0
    expect(entrance.x).toBe(0);
    expect(entrance.y).toBe(0);
  });

  it("omits x/y/level for rooms no directional exit can reach", () => {
    const withIsland: Adventure = {
      ...adventure,
      entities: {
        ...adventure.entities,
        rooms: [
          ...adventure.entities!.rooms!,
          { id: "island", name: "Floating Island", description: "d" },
        ],
      },
    };
    const model = buildMapModel(withIsland);
    const island = model.rooms.find((r) => r.id === "island")!;
    expect(island.x).toBeUndefined();
    expect(island.y).toBeUndefined();
    expect(island.level).toBeUndefined();
    expect(island.exits).toEqual({});
  });

  it("handles adventures with no authored rooms", () => {
    const bare: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    expect(buildMapModel(bare)).toEqual({ title: "Cave of Echoes", rooms: [] });
  });
});
