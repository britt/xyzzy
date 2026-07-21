import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  canonicalizeAction,
  EmptyNarrationError,
  expandBeatEffects,
  runTurn,
  type TurnDeps,
} from "./turnLoop.js";
import { newGameState } from "./state.js";
import { FakeNarratorModel, type NarratorModel } from "../llm/NarratorModel.js";
import { FakeDetector } from "../llm/Detector.js";
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

  it("does not ask the narration model to move (detection owns movement)", () => {
    const prompt = buildSystemPrompt(adventure).toLowerCase();
    expect(prompt).not.toContain("moveto");
    // Positive guidance that movement is engine-handled should remain.
    expect(prompt).toContain("automatically");
  });
});

describe("canonicalizeAction", () => {
  // `adventure` has start (exit north -> hall) and hall (no exits).
  const atStart = newGameState(adventure, "c"); // location: "start"

  it("resolves a room name to its id, leaving ids and unknowns untouched", () => {
    expect(
      canonicalizeAction(adventure, atStart, { type: "moveTo", room: "Hall" }),
    ).toEqual({ type: "moveTo", room: "hall" });
    expect(
      canonicalizeAction(adventure, atStart, { type: "moveTo", room: "hall" }),
    ).toEqual({ type: "moveTo", room: "hall" });
    // improvised room the model invented — pass through unchanged
    expect(
      canonicalizeAction(adventure, atStart, { type: "moveTo", room: "attic" }),
    ).toEqual({ type: "moveTo", room: "attic" });
  });

  it("resolves an exit direction to the target room id", () => {
    expect(
      canonicalizeAction(adventure, atStart, { type: "moveTo", room: "north" }),
    ).toEqual({ type: "moveTo", room: "hall" });
  });

  it("resolves a direction case-insensitively", () => {
    expect(
      canonicalizeAction(adventure, atStart, { type: "moveTo", room: "North" }),
    ).toEqual({ type: "moveTo", room: "hall" });
  });

  it("leaves a direction untouched when the current room has no such exit", () => {
    const atHall = { ...atStart, location: "hall" }; // hall has no exits
    expect(
      canonicalizeAction(adventure, atHall, { type: "moveTo", room: "north" }),
    ).toEqual({ type: "moveTo", room: "north" });
  });
});

describe("expandBeatEffects", () => {
  const withBeats: Adventure = {
    meta: { id: "a", title: "A", version: "1" },
    premise: "p",
    start: { room: "start" },
    beats: [
      {
        id: "claim",
        description: "Take the gem.",
        effects: [
          { type: "setGameState", key: "treasureClaimed", value: true },
        ],
      },
      { id: "plain", description: "A beat with no effects." },
    ],
  };

  it("inserts a beat's effects before the advanceBeat action", () => {
    const state = newGameState(withBeats, "c");
    expect(
      expandBeatEffects(withBeats, state, [
        { type: "advanceBeat", beatId: "claim" },
      ]),
    ).toEqual([
      { type: "setGameState", key: "treasureClaimed", value: true },
      { type: "advanceBeat", beatId: "claim" },
    ]);
  });

  it("does not reapply effects when the beat is already advanced", () => {
    const state = {
      ...newGameState(withBeats, "c"),
      flags: { "beat:claim": "advanced" },
    };
    expect(
      expandBeatEffects(withBeats, state, [
        { type: "advanceBeat", beatId: "claim" },
      ]),
    ).toEqual([{ type: "advanceBeat", beatId: "claim" }]);
  });

  it("passes through non-beat actions and effect-less beats unchanged", () => {
    const state = newGameState(withBeats, "c");
    const actions = [
      { type: "moveTo", room: "hall" },
      { type: "advanceBeat", beatId: "plain" },
      { type: "advanceBeat", beatId: "unknown" },
    ] as const;
    expect(expandBeatEffects(withBeats, state, [...actions])).toEqual(actions);
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

  it("moves when the model passes a direction as the room (the go-north bug)", async () => {
    // Model emits the direction verbatim instead of resolving it to a room id.
    const model = new FakeNarratorModel([
      { narration: "You head north.", actions: [{ type: "moveTo", room: "north" }] },
    ]);
    const { state } = await runTurn(
      deps(model),
      newGameState(adventure, "c"), // location: "start", exit north -> hall
      "go north",
    );
    expect(state.location).toBe("hall"); // resolved via the exit, not dropped
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

  it("applies a beat's declared effects when the model advances it", async () => {
    const gem: Adventure = {
      meta: { id: "g", title: "G", version: "1" },
      premise: "p",
      start: { room: "start" },
      entities: { rooms: [{ id: "start", name: "Start", description: "d" }] },
      beats: [
        {
          id: "claim",
          description: "Take the gem.",
          effects: [
            { type: "setGameState", key: "treasureClaimed", value: true },
          ],
        },
      ],
    };
    // Model advances the beat but never emits the setGameState itself.
    const model = new FakeNarratorModel([
      {
        narration: "You pocket the gem.",
        actions: [{ type: "advanceBeat", beatId: "claim" }],
      },
    ]);
    const { state } = await runTurn(
      { adventure: gem, model, clock: () => "t" },
      newGameState(gem, "c"),
      "take gem",
    );
    expect(state.state.treasureClaimed).toBe(true); // effect applied by the engine
    expect(state.flags["beat:claim"]).toBe("advanced");
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

  it("moves the player when detection returns a direction", async () => {
    const model = new FakeNarratorModel([{ narration: "You go.", actions: [] }]);
    const detector = new FakeDetector([
      { move: "north", advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
    ]);
    const { state } = await runTurn(
      { ...deps(model), detector },
      newGameState(adventure, "c"), // at "start", north -> hall
      "go north",
    );
    expect(state.location).toBe("hall");
  });

  it("advances a detected beat and applies its effects", async () => {
    const gem: Adventure = {
      meta: { id: "g", title: "G", version: "1" },
      premise: "p",
      start: { room: "start" },
      entities: { rooms: [{ id: "start", name: "Start", description: "d" }] },
      beats: [
        {
          id: "claim",
          description: "Take the gem.",
          effects: [{ type: "setGameState", key: "treasureClaimed", value: true }],
        },
      ],
    };
    const model = new FakeNarratorModel([{ narration: "ok", actions: [] }]);
    const detector = new FakeDetector([
      { move: null, advancedBeats: ["claim"], advancedCharacterBeats: [], triggeredInteractions: [] },
    ]);
    const { state } = await runTurn(
      { adventure: gem, model, detector, clock: () => "t" },
      newGameState(gem, "c"),
      "take gem",
    );
    expect(state.flags["beat:claim"]).toBe("advanced");
    expect(state.state.treasureClaimed).toBe(true);
  });

  it("degrades to no movement when detection throws", async () => {
    const model = new FakeNarratorModel([{ narration: "You go.", actions: [] }]);
    const detector = {
      detect: () => Promise.reject(new Error("detector down")),
    };
    const { state } = await runTurn(
      { ...deps(model), detector },
      newGameState(adventure, "c"),
      "go north",
    );
    expect(state.location).toBe("start"); // turn still completes, no move
  });

  it("ignores moveTo/advanceBeat emitted by the narration model (detection owns them)", async () => {
    const model = new FakeNarratorModel([
      { narration: "You go.", actions: [{ type: "moveTo", room: "hall" }] },
    ]);
    const detector = new FakeDetector([
      { move: null, advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
    ]);
    const { state } = await runTurn(
      { ...deps(model), detector },
      newGameState(adventure, "c"),
      "look",
    );
    expect(state.location).toBe("start"); // narration's moveTo dropped
  });

  it("narrates against the post-move room (new exits footer)", async () => {
    const model = new FakeNarratorModel([{ narration: "You arrive.", actions: [] }]);
    const detector = new FakeDetector([
      { move: "north", advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
    ]);
    const { narration } = await runTurn(
      { ...deps(model), detector },
      newGameState(adventure, "c"),
      "go north",
    );
    // "hall" has no exits -> the dead-end footer, not "start"'s north exit.
    expect(narration).toContain("no obvious way out");
  });
});
