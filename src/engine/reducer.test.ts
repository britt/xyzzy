import { describe, expect, it } from "vitest";
import { reduce, reduceAll } from "./reducer.js";
import type { Action } from "../world/actions.js";
import type { GameState } from "../world/schema.js";

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    adventureId: "test",
    adventureVersion: "1",
    location: "start",
    inventory: [],
    flags: {},
    state: {},
    characters: {},
    turn: 0,
    transcript: [],
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("reduce", () => {
  it("does not mutate the input state", () => {
    const state = baseState();
    reduce(state, { type: "moveTo", room: "hallway" });
    expect(state.location).toBe("start");
  });

  it("moveTo sets location", () => {
    const next = reduce(baseState(), { type: "moveTo", room: "hallway" });
    expect(next.location).toBe("hallway");
  });

  it("addItem appends without duplicating", () => {
    let s = reduce(baseState(), { type: "addItem", item: "lamp" });
    s = reduce(s, { type: "addItem", item: "lamp" });
    expect(s.inventory).toEqual(["lamp"]);
  });

  it("removeItem drops the item", () => {
    const start = baseState({ inventory: ["lamp", "key"] });
    const next = reduce(start, { type: "removeItem", item: "lamp" });
    expect(next.inventory).toEqual(["key"]);
  });

  it("setFlag and setGameState write their bags", () => {
    let s = reduce(baseState(), { type: "setFlag", key: "seen", value: true });
    s = reduce(s, { type: "setGameState", key: "score", value: 10 });
    expect(s.flags.seen).toBe(true);
    expect(s.state.score).toBe(10);
  });

  it("setCharacterState creates a live character when absent", () => {
    const next = reduce(baseState(), {
      type: "setCharacterState",
      charId: "guard",
      key: "trust",
      value: 5,
    });
    expect(next.characters.guard?.state.trust).toBe(5);
  });

  it("appendCharacterHistory accumulates summaries", () => {
    let s = reduce(baseState(), {
      type: "appendCharacterHistory",
      charId: "guard",
      summary: "met the player",
    });
    s = reduce(s, {
      type: "appendCharacterHistory",
      charId: "guard",
      summary: "was bribed",
    });
    expect(s.characters.guard?.history).toEqual([
      "met the player",
      "was bribed",
    ]);
  });

  it("moveCharacter sets a character location", () => {
    const next = reduce(baseState(), {
      type: "moveCharacter",
      charId: "guard",
      room: "gate",
    });
    expect(next.characters.guard?.location).toBe("gate");
  });

  it("advanceBeat records an advanced beat flag", () => {
    const next = reduce(baseState(), { type: "advanceBeat", beatId: "escape" });
    expect(next.flags["beat:escape"]).toBe("advanced");
  });

  it("advanceCharacterBeat records an advanced beat flag scoped to the character", () => {
    const next = reduce(baseState(), {
      type: "advanceCharacterBeat",
      charId: "barkeep",
      beatId: "confess",
    });
    expect(next.characters.barkeep?.state["beat:confess"]).toBe("advanced");
  });

  it("triggerInteraction increments a per-character count starting from zero", () => {
    let s = reduce(baseState(), {
      type: "triggerInteraction",
      charId: "barkeep",
      interactionId: "offer-drink",
    });
    expect(s.characters.barkeep?.state["interaction:offer-drink:count"]).toBe(1);
    s = reduce(s, {
      type: "triggerInteraction",
      charId: "barkeep",
      interactionId: "offer-drink",
    });
    expect(s.characters.barkeep?.state["interaction:offer-drink:count"]).toBe(2);
  });

  it("reduceAll folds a sequence in order", () => {
    const actions: Action[] = [
      { type: "moveTo", room: "hallway" },
      { type: "addItem", item: "lamp" },
      { type: "setFlag", key: "lit", value: true },
    ];
    const next = reduceAll(baseState(), actions);
    expect(next.location).toBe("hallway");
    expect(next.inventory).toEqual(["lamp"]);
    expect(next.flags.lit).toBe(true);
  });
});
