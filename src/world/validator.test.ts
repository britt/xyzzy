import { describe, expect, it } from "vitest";
import { checkCrossReferences, validateAdventure } from "./validator.js";
import type { Adventure } from "./schema.js";

const minimal = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: {},
};

describe("validateAdventure", () => {
  it("accepts a minimal adventure", () => {
    expect(validateAdventure(minimal).ok).toBe(true);
  });

  it("reports schema issues with dotted paths", () => {
    const result = validateAdventure({
      meta: { id: "a", title: "A", version: "1" },
      // premise missing
      start: {},
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "premise")).toBe(true);
  });

  it("formats array indices in the path", () => {
    const result = validateAdventure({
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      entities: { rooms: [{ id: "r", name: "R" /* description missing */ }] },
    });
    expect(result.issues.some((i) => i.path === "entities.rooms[0].description"))
      .toBe(true);
  });
});

describe("checkCrossReferences", () => {
  function base(overrides: Partial<Adventure>): Adventure {
    return {
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      ...overrides,
    } as Adventure;
  }

  it("flags an exit to an unknown room", () => {
    const issues = checkCrossReferences(
      base({
        entities: {
          rooms: [
            {
              id: "hall",
              name: "Hall",
              description: "d",
              exits: { north: "attic" },
            },
          ],
        },
      }),
    );
    expect(issues).toEqual([
      { path: "entities.rooms[0].exits.north", message: 'unknown room "attic"' },
    ]);
  });

  it("allows an item held by a character", () => {
    const issues = checkCrossReferences(
      base({
        entities: {
          characters: [
            { id: "g", name: "G", persona: "p", history: [], state: {} },
          ],
          items: [{ id: "coin", name: "coin", description: "d", location: "g" }],
        },
      }),
    );
    expect(issues).toHaveLength(0);
  });

  it("flags an item in an unknown location", () => {
    const issues = checkCrossReferences(
      base({
        entities: {
          items: [
            { id: "coin", name: "coin", description: "d", location: "void" },
          ],
        },
      }),
    );
    expect(issues[0]?.path).toBe("entities.items[0].location");
  });

  it("flags start.room and start.inventory that do not resolve", () => {
    const issues = checkCrossReferences(
      base({ start: { room: "nowhere", inventory: ["ghost"] } }),
    );
    expect(issues.map((i) => i.path).sort()).toEqual([
      "start.inventory[0]",
      "start.room",
    ]);
  });
});
