import { describe, expect, it } from "vitest";
import { Adventure } from "./schema.js";
import { Action } from "./actions.js";

describe("Adventure schema", () => {
  it("accepts a minimal adventure (meta + premise + start)", () => {
    const result = Adventure.safeParse({
      meta: { id: "a", title: "A", version: "1" },
      premise: "You wake in a dark cave.",
      start: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const result = Adventure.safeParse({
      meta: { id: "a", title: "A", version: "1" },
      start: {},
    });
    expect(result.success).toBe(false);
  });

  it("retains a beat's declared effects as parsed actions", () => {
    const parsed = Adventure.parse({
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      beats: [
        {
          id: "claim-the-gem",
          description: "Take the gem.",
          effects: [
            { type: "setGameState", key: "treasureClaimed", value: true },
          ],
        },
      ],
    });
    expect(parsed.beats?.[0]?.effects).toEqual([
      { type: "setGameState", key: "treasureClaimed", value: true },
    ]);
  });

  it("rejects a beat effect that is not a valid action", () => {
    const result = Adventure.safeParse({
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      beats: [
        {
          id: "b",
          description: "d",
          effects: [{ type: "teleport", room: "x" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("defaults character history and state", () => {
    const parsed = Adventure.parse({
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      entities: {
        characters: [{ id: "g", name: "Guard", persona: "gruff" }],
      },
    });
    expect(parsed.entities?.characters?.[0]?.history).toEqual([]);
    expect(parsed.entities?.characters?.[0]?.state).toEqual({});
  });
});

describe("Action schema", () => {
  it("validates a well-formed action", () => {
    expect(Action.safeParse({ type: "moveTo", room: "hall" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown action type", () => {
    expect(Action.safeParse({ type: "teleport", room: "x" }).success).toBe(
      false,
    );
  });

  it("rejects a wrong-typed argument", () => {
    expect(
      Action.safeParse({ type: "setFlag", key: "k", value: { nested: 1 } })
        .success,
    ).toBe(false);
  });
});
