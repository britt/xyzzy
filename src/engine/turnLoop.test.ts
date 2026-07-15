import { describe, expect, it } from "vitest";
import { EmptyNarrationError, runTurn, type TurnDeps } from "./turnLoop.js";
import { newGameState } from "./state.js";
import { FakeNarratorModel, type NarratorModel } from "../llm/NarratorModel.js";
import type { Adventure } from "../world/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: { room: "start" },
  entities: {
    rooms: [
      {
        id: "start",
        name: "Start",
        description: "d",
        exits: { north: "hall" },
      },
      { id: "hall", name: "Hall", description: "d" },
    ],
  },
};

function deps(model: NarratorModel): TurnDeps {
  return { adventure, model, clock: () => "2026-07-15T00:00:00.000Z" };
}

describe("runTurn", () => {
  it("applies validated actions and appends transcript", async () => {
    const model = new FakeNarratorModel([
      {
        narration: "You head north.",
        actions: [
          { type: "moveTo", room: "hall" },
          { type: "setFlag", key: "moved", value: true },
        ],
      },
    ]);
    const start = newGameState(adventure, "created");
    const { narration, state } = await runTurn(deps(model), start, "go north");

    expect(narration).toBe("You head north.");
    expect(state.location).toBe("hall");
    expect(state.flags.moved).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.transcript).toEqual([
      { role: "player", text: "go north", turn: 1 },
      { role: "narrator", text: "You head north.", turn: 1 },
    ]);
    expect(state.updatedAt).toBe("2026-07-15T00:00:00.000Z");
  });

  it("drops malformed tool-calls before the reducer", async () => {
    const model = new FakeNarratorModel([
      {
        narration: "ok",
        actions: [
          { type: "moveTo", room: "hall" },
          { type: "moveTo" }, // missing room → dropped
          { type: "bogus", x: 1 }, // unknown → dropped
        ],
      },
    ]);
    const { state } = await runTurn(
      deps(model),
      newGameState(adventure, "c"),
      "go",
    );
    expect(state.location).toBe("hall");
  });

  it("does not mutate the input state (clean rollback boundary)", async () => {
    const model = new FakeNarratorModel([
      { narration: "x", actions: [{ type: "moveTo", room: "hall" }] },
    ]);
    const start = newGameState(adventure, "c");
    await runTurn(deps(model), start, "go");
    expect(start.location).toBe("start");
    expect(start.turn).toBe(0);
    expect(start.transcript).toEqual([]);
  });

  it("propagates model errors so the caller keeps its state", async () => {
    const throwing: NarratorModel = {
      generate: () => Promise.reject(new Error("connection refused")),
    };
    await expect(
      runTurn(deps(throwing), newGameState(adventure, "c"), "go"),
    ).rejects.toThrow("connection refused");
  });

  it("retries once on empty narration, then succeeds", async () => {
    const model = new FakeNarratorModel([
      { narration: "", actions: [] },
      { narration: "recovered", actions: [] },
    ]);
    const { narration } = await runTurn(
      deps(model),
      newGameState(adventure, "c"),
      "go",
    );
    expect(narration).toBe("recovered");
  });

  it("throws EmptyNarrationError when narration stays empty", async () => {
    const model = new FakeNarratorModel([{ narration: "", actions: [] }]);
    await expect(
      runTurn(deps(model), newGameState(adventure, "c"), "go"),
    ).rejects.toBeInstanceOf(EmptyNarrationError);
  });
});
