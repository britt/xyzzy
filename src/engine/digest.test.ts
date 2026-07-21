import { describe, expect, it } from "vitest";
import {
  buildDigest,
  isBeatAdvanced,
  isCharacterBeatAdvanced,
  interactionCount,
  isInteractionExhausted,
} from "./digest.js";
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
        beats: [{ id: "reveal-name", description: "Grimble shares his true name." }],
        interactions: [
          { id: "grumble", description: "Grimble grumbles about the noise.", limit: 2 },
        ],
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

  it("lists a present character's beats and interactions as goals, with count/limit", () => {
    expect(digest).toContain("[reveal-name] Grimble shares his true name.");
    expect(digest).toContain("[grumble] Grimble grumbles about the noise. (0/2)");
  });

  it("hides a character beat once advanced, and updates an interaction's count", () => {
    const next = buildDigest(adventure, {
      ...state,
      characters: {
        ...state.characters,
        grimble: {
          ...state.characters.grimble!,
          state: {
            ...state.characters.grimble!.state,
            "beat:reveal-name": "advanced",
            "interaction:grumble:count": 1,
          },
        },
      },
    });
    expect(next).not.toContain("[reveal-name]");
    expect(next).toContain("[grumble] Grimble grumbles about the noise. (1/2)");
  });

  it("omits a character's goals line entirely once every beat/interaction is exhausted", () => {
    const exhausted = buildDigest(adventure, {
      ...state,
      characters: {
        ...state.characters,
        grimble: {
          ...state.characters.grimble!,
          state: {
            ...state.characters.grimble!.state,
            "beat:reveal-name": "advanced",
            "interaction:grumble:count": 2,
          },
        },
      },
    });
    // "goals:" alone would also match the unrelated top-level "Active goals:"
    // line (still rendered here since the fixture's global "escape" beat is
    // untouched); check the character-specific block's indented header.
    expect(exhausted).not.toContain("    goals:");
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

describe("isCharacterBeatAdvanced / interactionCount / isInteractionExhausted", () => {
  it("reads the character-scoped beat flag", () => {
    const s = newGameState(adventure, "now");
    expect(isCharacterBeatAdvanced(s, "grimble", "reveal-name")).toBe(false);
    const advanced = {
      ...s,
      characters: {
        ...s.characters,
        grimble: {
          ...s.characters.grimble!,
          state: { ...s.characters.grimble!.state, "beat:reveal-name": "advanced" },
        },
      },
    };
    expect(isCharacterBeatAdvanced(advanced, "grimble", "reveal-name")).toBe(true);
  });

  it("counts interaction fires and reports exhaustion once the limit is hit", () => {
    const s = newGameState(adventure, "now");
    const interaction = adventure.entities!.characters![0]!.interactions![0]!;
    expect(interactionCount(s, "grimble", "grumble")).toBe(0);
    expect(isInteractionExhausted(s, "grimble", interaction)).toBe(false);

    const oneShort = {
      ...s,
      characters: {
        ...s.characters,
        grimble: {
          ...s.characters.grimble!,
          state: { ...s.characters.grimble!.state, "interaction:grumble:count": 1 },
        },
      },
    };
    expect(isInteractionExhausted(oneShort, "grimble", interaction)).toBe(false);

    const atLimit = {
      ...s,
      characters: {
        ...s.characters,
        grimble: {
          ...s.characters.grimble!,
          state: { ...s.characters.grimble!.state, "interaction:grumble:count": 2 },
        },
      },
    };
    expect(isInteractionExhausted(atLimit, "grimble", interaction)).toBe(true);
  });

  it("an interaction with no limit is never exhausted", () => {
    const unlimited = { id: "chat", description: "d" }; // no `limit`
    const s = newGameState(adventure, "now");
    expect(isInteractionExhausted(s, "grimble", unlimited)).toBe(false);
  });
});
