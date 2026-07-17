import { describe, expect, it } from "vitest";
import { buildDetectionSchema } from "./detection.js";

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
