import { describe, expect, it } from "vitest";
import { buildDetectionSchema, buildDetectionContext } from "./detection.js";
import type { Adventure } from "../world/schema.js";
import { newGameState } from "../engine/state.js";

const exits = [{ direction: "north", destination: "The Still Lake" }];
const beats = [{ id: "find-light", trigger: "player lights the lantern" }];

describe("buildDetectionSchema", () => {
  it("accepts a valid direction and beat id", () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(
      schema.parse({ move: "north", advancedBeats: ["find-light"] }),
    ).toEqual({ move: "north", advancedBeats: ["find-light"] });
  });

  it("maps \"none\" to a null move and defaults advancedBeats", () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(schema.parse({ move: "none" })).toEqual({
      move: null,
      advancedBeats: [],
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
    expect(schema.parse({ move: "none" })).toEqual({ move: null, advancedBeats: [] });
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
});
