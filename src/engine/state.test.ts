import { describe, expect, it } from "vitest";
import { newGameState } from "./state.js";
import type { Adventure } from "../world/schema.js";

const adventure: Adventure = {
  meta: { id: "cave", title: "Cave", version: "2.0" },
  premise: "p",
  start: {
    room: "entrance",
    inventory: ["lamp"],
    flags: { lit: false },
    state: { score: 0 },
  },
  entities: {
    characters: [
      {
        id: "guard",
        name: "Guard",
        persona: "gruff",
        location: "gate",
        history: ["stood here for years"],
        state: { trust: 5 },
      },
    ],
  },
};

describe("newGameState", () => {
  it("seeds from meta + start", () => {
    const s = newGameState(adventure, "2026-07-15T00:00:00.000Z");
    expect(s.adventureId).toBe("cave");
    expect(s.adventureVersion).toBe("2.0");
    expect(s.location).toBe("entrance");
    expect(s.inventory).toEqual(["lamp"]);
    expect(s.flags).toEqual({ lit: false });
    expect(s.state).toEqual({ score: 0 });
    expect(s.turn).toBe(0);
    expect(s.transcript).toEqual([]);
    expect(s.createdAt).toBe("2026-07-15T00:00:00.000Z");
  });

  it("copies characters into live form", () => {
    const s = newGameState(adventure, "now");
    expect(s.characters.guard).toEqual({
      location: "gate",
      history: ["stood here for years"],
      state: { trust: 5 },
    });
  });

  it("defaults location to null when start.room is omitted", () => {
    const s = newGameState(
      { ...adventure, start: {} },
      "now",
    );
    expect(s.location).toBeNull();
    expect(s.inventory).toEqual([]);
  });

  it("does not alias the adventure's character arrays", () => {
    const s = newGameState(adventure, "now");
    s.characters.guard?.history.push("mutated");
    expect(adventure.entities?.characters?.[0]?.history).toEqual([
      "stood here for years",
    ]);
  });
});
