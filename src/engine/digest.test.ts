import { describe, expect, it } from "vitest";
import { buildDigest, isBeatAdvanced } from "./digest.js";
import { newGameState } from "./state.js";
import type { Adventure } from "../world/schema.js";

const adventure: Adventure = {
  meta: { id: "cave", title: "Cave", version: "1" },
  premise: "p",
  start: { room: "cavern", inventory: ["rope"] },
  entities: {
    rooms: [
      {
        id: "cavern",
        name: "Great Cavern",
        description: "A vast echoing space.",
        exits: { north: "lake" },
      },
      { id: "lake", name: "Lake", description: "Dark water." },
    ],
    items: [
      { id: "rope", name: "rope", description: "d", location: "cavern" },
      { id: "lantern", name: "lantern", description: "d", location: "cavern" },
    ],
    characters: [
      {
        id: "grimble",
        name: "Grimble",
        persona: "a troll",
        location: "cavern",
        history: ["ancient guardian"],
        state: { mood: "wary" },
      },
    ],
  },
  beats: [{ id: "escape", description: "Get out alive." }],
};

describe("buildDigest", () => {
  const state = newGameState(adventure, "now");
  const digest = buildDigest(adventure, state);

  it("shows the current room, description, and exits with target names", () => {
    expect(digest).toContain("Great Cavern [cavern]");
    expect(digest).toContain("A vast echoing space.");
    expect(digest).toContain("north to Lake [lake]");
  });

  it("lists items present but not carried", () => {
    expect(digest).toContain("lantern [lantern]");
    expect(digest).not.toContain("rope [rope]"); // carried, excluded
  });

  it("shows characters in the room with state and history", () => {
    expect(digest).toContain("Grimble [grimble]");
    expect(digest).toContain('mood="wary"');
    expect(digest).toContain("ancient guardian");
  });

  it("lists active beats and hides advanced ones", () => {
    expect(digest).toContain("[escape] Get out alive.");
    const advanced = buildDigest(adventure, {
      ...state,
      flags: { "beat:escape": "advanced" },
    });
    expect(advanced).not.toContain("[escape]");
  });
});

describe("isBeatAdvanced", () => {
  it("reads the beat flag", () => {
    const s = newGameState(adventure, "now");
    expect(isBeatAdvanced(s, "escape")).toBe(false);
    expect(
      isBeatAdvanced({ ...s, flags: { "beat:escape": "advanced" } }, "escape"),
    ).toBe(true);
  });
});
