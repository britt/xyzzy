import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  canonicalizeAction,
  EmptyNarrationError,
  runTurn,
  type TurnDeps,
} from "./turnLoop.js";
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

describe("buildSystemPrompt", () => {
  it("instructs the model to always list exits and their directions", () => {
    const prompt = buildSystemPrompt(adventure).toLowerCase();
    expect(prompt).toContain("exit");
    expect(prompt).toContain("direction");
    expect(prompt).toContain(adventure.premise.toLowerCase());
  });
});

describe("canonicalizeAction", () => {
  it("resolves a room name to its id, leaving ids and unknowns untouched", () => {
    expect(canonicalizeAction(adventure, { type: "moveTo", room: "Hall" })).toEqual(
      { type: "moveTo", room: "hall" },
    );
    expect(canonicalizeAction(adventure, { type: "moveTo", room: "hall" })).toEqual(
      { type: "moveTo", room: "hall" },
    );
    // improvised room the model invented — pass through unchanged
    expect(
      canonicalizeAction(adventure, { type: "moveTo", room: "attic" }),
    ).toEqual({ type: "moveTo", room: "attic" });
  });
});

describe("runTurn", () => {
  it("stores the room id when the model moves by name (the failure.json bug)", async () => {
    const model = new FakeNarratorModel([
      { narration: "You go.", actions: [{ type: "moveTo", room: "Hall" }] },
    ]);
    const { state } = await runTurn(
      deps(model),
      newGameState(adventure, "c"),
      "go",
    );
    expect(state.location).toBe("hall"); // the id, not "Hall"
  });

  it("rejects a move to a room not defined in the adventure", async () => {
    const model = new FakeNarratorModel([
      {
        narration: "You try to descend.",
        actions: [{ type: "moveTo", room: "The Undercity" }],
      },
    ]);
    const start = newGameState(adventure, "c"); // location: "start"
    const { state } = await runTurn(deps(model), start, "go down");
    expect(state.location).toBe("start"); // move dropped; player stays put
  });

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

    expect(narration).toContain("You head north.");
    expect(state.location).toBe("hall");
    expect(state.flags.moved).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.transcript[0]).toEqual({
      role: "player",
      text: "go north",
      turn: 1,
    });
    expect(state.transcript[1]).toMatchObject({ role: "narrator", turn: 1 });
    expect(state.transcript[1]!.text).toContain("You head north.");
    expect(state.updatedAt).toBe("2026-07-15T00:00:00.000Z");
  });

  it("always appends the complete list of exits to the narration", async () => {
    const hub: Adventure = {
      meta: { id: "h", title: "H", version: "1" },
      premise: "p",
      start: { room: "hub" },
      entities: {
        rooms: [
          {
            id: "hub",
            name: "Hub",
            description: "d",
            exits: { north: "n", east: "e", west: "w" },
          },
          { id: "n", name: "North Room", description: "d" },
          { id: "e", name: "East Room", description: "d" },
          { id: "w", name: "West Room", description: "d" },
        ],
      },
    };
    const model = new FakeNarratorModel([{ narration: "You look.", actions: [] }]);
    const { narration } = await runTurn(
      { adventure: hub, model, clock: () => "t" },
      newGameState(hub, "c"),
      "look",
    );

    // Every exit is present, not just the first.
    expect(narration).toContain("north to North Room");
    expect(narration).toContain("east to East Room");
    expect(narration).toContain("west to West Room");
  });

  it("replaces a model's truncated/echoed exits line with the full one", async () => {
    const hub: Adventure = {
      meta: { id: "h", title: "H", version: "1" },
      premise: "p",
      start: { room: "hub" },
      entities: {
        rooms: [
          {
            id: "hub",
            name: "Hub",
            description: "d",
            exits: { north: "n", east: "e", west: "w" },
          },
          { id: "n", name: "North Room", description: "d" },
          { id: "e", name: "East Room", description: "d" },
          { id: "w", name: "West Room", description: "d" },
        ],
      },
    };
    // Model copies the digest line but truncates it to one exit with an id.
    const model = new FakeNarratorModel([
      { narration: "You stand in a hub. Exits: north to North Room [n].", actions: [] },
    ]);
    const { narration } = await runTurn(
      { adventure: hub, model, clock: () => "t" },
      newGameState(hub, "c"),
      "look",
    );

    expect(narration).not.toContain("[n]"); // internal id gone
    expect(narration.match(/Exits/gi)).toHaveLength(1); // exactly one exits block
    // bulleted list under an "Exits" header
    expect(narration).toContain("Exits\n- north to North Room");
    expect(narration).toContain("- east to East Room");
    expect(narration).toContain("- west to West Room");
    expect(narration).toContain("You stand in a hub."); // prose preserved
  });

  it("reports no exits for a dead-end room", async () => {
    // adventure's "hall" has no exits.
    const model = new FakeNarratorModel([
      { narration: "A dead end.", actions: [{ type: "moveTo", room: "hall" }] },
    ]);
    const { narration } = await runTurn(
      deps(model),
      newGameState(adventure, "c"),
      "go",
    );
    expect(narration).toContain("no obvious way out");
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
    expect(narration).toContain("recovered");
  });

  it("throws EmptyNarrationError when narration stays empty", async () => {
    const model = new FakeNarratorModel([{ narration: "", actions: [] }]);
    await expect(
      runTurn(deps(model), newGameState(adventure, "c"), "go"),
    ).rejects.toBeInstanceOf(EmptyNarrationError);
  });
});
