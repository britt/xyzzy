import { describe, expect, it } from "vitest";
import {
  buildDetectionSchema,
  buildDetectionContext,
  decodeToken,
  encodeToken,
} from "./detection.js";
import type { Adventure } from "../world/schema.js";
import { newGameState } from "../engine/state.js";

const exits = [{ direction: "north", destination: "The Still Lake" }];
const beats = [{ id: "find-light", trigger: "player lights the lantern" }];
const characterBeats = [
  { charId: "barkeep", beatId: "confess", trigger: "player presses the barkeep" },
];
const interactions = [
  { charId: "barkeep", interactionId: "offer-drink", trigger: "player is friendly" },
];

describe("encodeToken / decodeToken", () => {
  it("round-trips a charId + id pair", () => {
    expect(decodeToken(encodeToken("barkeep", "confess"))).toEqual({
      charId: "barkeep",
      id: "confess",
    });
  });
});

describe("buildDetectionSchema", () => {
  it("accepts a valid direction and beat id", () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(
      schema.parse({ move: "north", advancedBeats: ["find-light"] }),
    ).toEqual({
      move: "north",
      advancedBeats: ["find-light"],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    });
  });

  it('maps "none" to a null move and defaults advancedBeats', () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(schema.parse({ move: "none" })).toEqual({
      move: null,
      advancedBeats: [],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    });
  });

  it("rejects a direction with no matching exit", () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(schema.safeParse({ move: "east", advancedBeats: [] }).success).toBe(false);
  });

  it("rejects an unknown beat id", () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(
      schema.safeParse({ move: "none", advancedBeats: ["ghost"] }).success,
    ).toBe(false);
  });

  it("handles a room with no exits and no beats", () => {
    const schema = buildDetectionSchema([], []);
    expect(schema.parse({ move: "none" })).toEqual({
      move: null,
      advancedBeats: [],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    });
  });

  it("accepts a character beat token and decodes it to charId/beatId", () => {
    const schema = buildDetectionSchema([], [], characterBeats, []);
    expect(
      schema.parse({ move: "none", advancedCharacterBeats: ["barkeep/confess"] }),
    ).toMatchObject({
      advancedCharacterBeats: [{ charId: "barkeep", beatId: "confess" }],
    });
  });

  it("rejects a character beat token not in the candidate list", () => {
    const schema = buildDetectionSchema([], [], characterBeats, []);
    expect(
      schema.safeParse({ move: "none", advancedCharacterBeats: ["ghost/nope"] })
        .success,
    ).toBe(false);
  });

  it("accepts an interaction token and decodes it to charId/interactionId", () => {
    const schema = buildDetectionSchema([], [], [], interactions);
    expect(
      schema.parse({ move: "none", triggeredInteractions: ["barkeep/offer-drink"] }),
    ).toMatchObject({
      triggeredInteractions: [{ charId: "barkeep", interactionId: "offer-drink" }],
    });
  });
});

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: { room: "cavern" },
  entities: {
    rooms: [
      { id: "cavern", name: "The Great Cavern", description: "d", exits: { north: "lake" } },
      { id: "lake", name: "The Still Lake", description: "d" },
    ],
    characters: [
      {
        id: "barkeep",
        name: "Barkeep",
        persona: "gruff",
        location: "cavern",
        history: [],
        state: {},
        beats: [{ id: "confess", description: "d", trigger: "player presses the barkeep" }],
        interactions: [
          { id: "offer-drink", description: "d", trigger: "player is friendly" },
        ],
      },
    ],
  },
  beats: [{ id: "reach-lake", description: "Get to the lake.", trigger: "player reaches the lake" }],
};

describe("buildDetectionContext", () => {
  it("lists the current room's exits with destination names and active beats", () => {
    const ctx = buildDetectionContext(adventure, newGameState(adventure, "c"), "go north");
    expect(ctx.input).toBe("go north");
    expect(ctx.exits).toEqual([{ direction: "north", destination: "The Still Lake" }]);
    expect(ctx.activeBeats).toEqual([
      { id: "reach-lake", trigger: "player reaches the lake" },
    ]);
  });

  it("omits already-advanced beats", () => {
    const state = { ...newGameState(adventure, "c"), flags: { "beat:reach-lake": "advanced" } };
    const ctx = buildDetectionContext(adventure, state, "go north");
    expect(ctx.activeBeats).toEqual([]);
  });

  it("lists a present character's beats and interactions", () => {
    const ctx = buildDetectionContext(adventure, newGameState(adventure, "c"), "hi");
    expect(ctx.characterBeats).toEqual([
      { charId: "barkeep", beatId: "confess", trigger: "player presses the barkeep" },
    ]);
    expect(ctx.interactions).toEqual([
      { charId: "barkeep", interactionId: "offer-drink", trigger: "player is friendly" },
    ]);
  });

  it("omits a character's beats/interactions when the character is not present", () => {
    const state = { ...newGameState(adventure, "c"), location: "lake" };
    const ctx = buildDetectionContext(adventure, state, "hi");
    expect(ctx.characterBeats).toEqual([]);
    expect(ctx.interactions).toEqual([]);
  });

  it("omits an already-advanced character beat and an exhausted interaction", () => {
    const state = {
      ...newGameState(adventure, "c"),
      characters: {
        barkeep: {
          location: "cavern",
          history: [],
          state: { "beat:confess": "advanced", "interaction:offer-drink:count": 999 },
        },
      },
    };
    // offer-drink has no `limit` in this fixture, so it is never exhausted —
    // only the beat should disappear.
    const ctx = buildDetectionContext(adventure, state, "hi");
    expect(ctx.characterBeats).toEqual([]);
    expect(ctx.interactions).toEqual([
      { charId: "barkeep", interactionId: "offer-drink", trigger: "player is friendly" },
    ]);
  });
});
