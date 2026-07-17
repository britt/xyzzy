# Structured Action Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make movement and beat-advancement reliable by deciding them in a structured detection pre-pass instead of relying on the narration model to emit tool calls.

**Architecture:** Each turn runs `detect -> apply -> narrate`. A `Detector` (structured completion with a closed-set, per-turn zod schema) returns `{ move, advancedBeats }`. The engine turns those into `moveTo`/`advanceBeat` actions, runs them through the existing canonicalize/filter/effects/reduce pipeline, then narrates against the updated state with `moveTo`/`advanceBeat` removed from the narration toolset.

**Tech Stack:** TypeScript, zod, Vercel AI SDK (`ai` — `generateObject`), `@ai-sdk/openai-compatible`, vitest.

**Prerequisite:** PR #4 (`fix/direction-movement`) must be merged first. This plan assumes `canonicalizeAction(adventure, state, action)` (3-arg) and `resolveMoveTarget` exist. If not merged, rebase this branch on it before starting.

**Design reference:** `docs/plans/2026-07-16-action-detection-design.md`.

**Conventions:** Run tests with `npx vitest run <file>`. Full gate before each commit: `npx vitest run && npm run typecheck && npm run lint`. Commit after every green task. Follow @superpowers:test-driven-development.

---

### Task 1: `Detector` interface + `FakeDetector`

**Files:**
- Create: `src/llm/Detector.ts`
- Test: `src/llm/Detector.test.ts`

**Step 1: Write the failing test**

```ts
// src/llm/Detector.test.ts
import { describe, expect, it } from "vitest";
import { FakeDetector, type Detection } from "./Detector.js";

describe("FakeDetector", () => {
  it("replays scripted detections in order, then repeats the last", async () => {
    const a: Detection = { move: "north", advancedBeats: [] };
    const b: Detection = { move: null, advancedBeats: ["find-light"] };
    const d = new FakeDetector([a, b]);

    expect(await d.detect({ input: "go north", exits: [], activeBeats: [] })).toEqual(a);
    expect(await d.detect({ input: "light lantern", exits: [], activeBeats: [] })).toEqual(b);
    expect(await d.detect({ input: "again", exits: [], activeBeats: [] })).toEqual(b);
  });

  it("defaults to an empty detection when unscripted", async () => {
    const d = new FakeDetector();
    expect(await d.detect({ input: "x", exits: [], activeBeats: [] })).toEqual({
      move: null,
      advancedBeats: [],
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/Detector.test.ts`
Expected: FAIL — cannot import `./Detector.js`.

**Step 3: Write minimal implementation**

```ts
// src/llm/Detector.ts

/** One exit visible to the detector: direction + destination display name. */
export interface DetectionExit {
  direction: string;
  destination: string;
}

/** One active beat visible to the detector: id + its trigger text. */
export interface DetectionBeat {
  id: string;
  trigger: string;
}

export interface DetectionContext {
  input: string;
  exits: DetectionExit[];
  activeBeats: DetectionBeat[];
}

/** The structured facts a detection extracts from the player's input. */
export interface Detection {
  /** exit direction (or null) the player is trying to take */
  move: string | null;
  /** ids of active beats whose triggers the input now satisfies */
  advancedBeats: string[];
}

export interface Detector {
  detect(ctx: DetectionContext): Promise<Detection>;
}

/** Deterministic detector for tests: replays a scripted queue, repeats the last. */
export class FakeDetector implements Detector {
  private readonly queue: Detection[];
  private index = 0;
  public readonly calls: DetectionContext[] = [];

  constructor(scripted: Detection[] = []) {
    this.queue = scripted;
  }

  async detect(ctx: DetectionContext): Promise<Detection> {
    this.calls.push(ctx);
    const next =
      this.queue[this.index] ??
      this.queue[this.queue.length - 1] ??
      ({ move: null, advancedBeats: [] } satisfies Detection);
    if (this.index < this.queue.length) this.index++;
    return next;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/Detector.test.ts`
Expected: PASS (2).

**Step 5: Commit**

```bash
git add src/llm/Detector.ts src/llm/Detector.test.ts
git commit -m "Add Detector interface and FakeDetector"
```

---

### Task 2: Per-turn detection schema

**Files:**
- Create: `src/llm/detection.ts`
- Test: `src/llm/detection.test.ts`

The schema is rebuilt each turn from the real exits and active beats, so the model can only return a valid direction or a real beat id.

**Step 1: Write the failing test**

```ts
// src/llm/detection.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/detection.test.ts`
Expected: FAIL — cannot import `./detection.js`.

**Step 3: Write minimal implementation**

```ts
// src/llm/detection.ts
import { z } from "zod";
import type { DetectionBeat, DetectionExit } from "./Detector.js";

/**
 * Build the per-turn detection schema. `move` is constrained to the current
 * room's exit directions (or "none" -> null); `advancedBeats` to the active beat
 * ids. Because the enums come from real state, the model cannot return garbage.
 */
export function buildDetectionSchema(
  exits: DetectionExit[],
  activeBeats: DetectionBeat[],
) {
  const directions = exits.map((e) => e.direction);
  const move = z
    .enum(["none", ...directions] as [string, ...string[]])
    .transform((v) => (v === "none" ? null : v));

  const beatIds = activeBeats.map((b) => b.id);
  const advancedBeats =
    beatIds.length > 0
      ? z.array(z.enum(beatIds as [string, ...string[]])).default([])
      : z.array(z.never()).default([]);

  return z.object({ move, advancedBeats });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/detection.test.ts`
Expected: PASS (5).

**Step 5: Commit**

```bash
git add src/llm/detection.ts src/llm/detection.test.ts
git commit -m "Add per-turn detection schema (closed-set move + beats)"
```

---

### Task 3: Build the detection context from game state

**Files:**
- Modify: `src/llm/detection.ts`
- Test: `src/llm/detection.test.ts`

**Step 1: Write the failing test** (append to `detection.test.ts`)

```ts
import { buildDetectionContext } from "./detection.js";
import type { Adventure } from "../world/schema.js";
import { newGameState } from "../engine/state.js";

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: { room: "cavern" },
  entities: {
    rooms: [
      { id: "cavern", name: "The Great Cavern", description: "d", exits: { north: "lake" } },
      { id: "lake", name: "The Still Lake", description: "d" },
    ],
  },
  beats: [{ id: "reach-lake", description: "Get to the lake.", trigger: "player reaches the lake" }],
};

describe("buildDetectionContext", () => {
  it("lists the current room's exits with destination names and active beats", () => {
    const ctx = buildDetectionContext(adventure, newGameState(adventure, "c"), "go north");
    expect(ctx.input).toBe("go north");
    expect(ctx.exits).toEqual([{ direction: "north", destination: "The Still Lake" }]);
    expect(ctx.activeBeats).toEqual([
      { id: "reach-lake", trigger: "player reaches the lake" },
    ]);
  });

  it("omits already-advanced beats", () => {
    const state = { ...newGameState(adventure, "c"), flags: { "beat:reach-lake": "advanced" } };
    const ctx = buildDetectionContext(adventure, state, "go north");
    expect(ctx.activeBeats).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/detection.test.ts`
Expected: FAIL — `buildDetectionContext` not exported.

**Step 3: Write minimal implementation** (append to `detection.ts`)

```ts
import type { Adventure, GameState } from "../world/schema.js";
import { isBeatAdvanced } from "../engine/digest.js";
import type { DetectionContext } from "./Detector.js";

/** Assemble the detector's view: current exits (with destinations) + active beats. */
export function buildDetectionContext(
  adventure: Adventure,
  state: GameState,
  input: string,
): DetectionContext {
  const rooms = adventure.entities?.rooms ?? [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const current = rooms.find((r) => r.id === state.location);

  const exits = Object.entries(current?.exits ?? {}).map(([direction, target]) => ({
    direction,
    destination: byId.get(target)?.name ?? target,
  }));

  const activeBeats = (adventure.beats ?? [])
    .filter((b) => !isBeatAdvanced(state, b.id))
    .map((b) => ({ id: b.id, trigger: (b.trigger ?? b.description).trim() }));

  return { input, exits, activeBeats };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/detection.test.ts`
Expected: PASS (7).

**Step 5: Commit**

```bash
git add src/llm/detection.ts src/llm/detection.test.ts
git commit -m "Build detection context (exits with destinations + active beats)"
```

---

### Task 4: Extract a shared action-processing helper in the turn loop

Refactor only — keep tests green. `runTurn` currently inlines validate -> canonicalize -> filter. Detection will reuse it, so extract it (DRY).

**Files:**
- Modify: `src/engine/turnLoop.ts` (the block at `turnLoop.ts:207-222`)

**Step 1: Add the helper** (place near `canonicalizeAction`)

```ts
/**
 * Validate raw tool-call args, canonicalize entity refs, and drop moves to
 * rooms not defined in the adventure. `exclude` skips action types owned by
 * another path (detection owns moveTo/advanceBeat during narration).
 */
export function processActions(
  adventure: Adventure,
  state: GameState,
  raw: unknown[],
  exclude: ReadonlyArray<Action["type"]> = [],
): Action[] {
  const rooms = adventure.entities?.rooms ?? [];
  const roomIds = new Set(rooms.map((r) => r.id));
  const restrictRooms = rooms.length > 0;

  return raw
    .map((a) => Action.safeParse(a))
    .flatMap((r) => (r.success ? [r.data] : []))
    .filter((a) => !exclude.includes(a.type))
    .map((a) => canonicalizeAction(adventure, state, a))
    .filter((action) => {
      const target =
        action.type === "moveTo" || action.type === "moveCharacter"
          ? action.room
          : null;
      if (target !== null && restrictRooms && !roomIds.has(target)) {
        log.warn(`rejected move to undefined room "${target}"`, { action });
        return false;
      }
      return true;
    });
}
```

**Step 2: Replace the inline block in `runTurn`** with:

```ts
  const actions = processActions(adventure, state, result.actions);
```

**Step 3: Run the full suite to verify still green**

Run: `npx vitest run src/engine/turnLoop.test.ts`
Expected: PASS (unchanged count).

**Step 4: Commit**

```bash
git add src/engine/turnLoop.ts
git commit -m "Extract processActions helper in turn loop (no behavior change)"
```

---

### Task 5: Detection pre-pass in `runTurn`

**Files:**
- Modify: `src/engine/turnLoop.ts` (`TurnDeps`, `runTurn`)
- Test: `src/engine/turnLoop.test.ts`

**Step 1: Write the failing tests** (append inside `describe("runTurn")`)

```ts
it("moves the player when detection returns a direction", async () => {
  const model = new FakeNarratorModel([{ narration: "You go.", actions: [] }]);
  const detector = new FakeDetector([{ move: "north", advancedBeats: [] }]);
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
  const detector = new FakeDetector([{ move: null, advancedBeats: ["claim"] }]);
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
  const detector = new FakeDetector([{ move: null, advancedBeats: [] }]);
  const { state } = await runTurn(
    { ...deps(model), detector },
    newGameState(adventure, "c"),
    "look",
  );
  expect(state.location).toBe("start"); // narration's moveTo dropped
});

it("narrates against the post-move room (new exits footer)", async () => {
  const model = new FakeNarratorModel([{ narration: "You arrive.", actions: [] }]);
  const detector = new FakeDetector([{ move: "north", advancedBeats: [] }]);
  const { narration } = await runTurn(
    { ...deps(model), detector },
    newGameState(adventure, "c"),
    "go north",
  );
  // "hall" has no exits -> the dead-end footer, not "start"'s north exit.
  expect(narration).toContain("no obvious way out");
});
```

Add the imports to the test file:

```ts
import { FakeDetector } from "../llm/Detector.js";
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/turnLoop.test.ts`
Expected: FAIL — `detector` not accepted by `TurnDeps` / not applied.

**Step 3: Implement**

Add to `TurnDeps`:

```ts
  /** optional structured detector for movement + beat triggers (pre-pass) */
  detector?: Detector;
```

Import at the top of `turnLoop.ts`:

```ts
import type { Detector } from "../llm/Detector.js";
import { buildDetectionContext } from "../llm/detection.js";
```

In `runTurn`, after building `context` but before the narration call, add the pre-pass and thread `midState` through:

```ts
  // --- Detection pre-pass: decide movement + beats deterministically ---
  let midState = state;
  if (deps.detector) {
    try {
      const detection = await deps.detector.detect(
        buildDetectionContext(adventure, state, input),
      );
      const detected: unknown[] = [];
      if (detection.move) detected.push({ type: "moveTo", room: detection.move });
      for (const id of detection.advancedBeats) {
        detected.push({ type: "advanceBeat", beatId: id });
      }
      const actions = processActions(adventure, state, detected);
      midState = reduceAll(state, expandBeatEffects(adventure, state, actions));
    } catch (err) {
      log.warn("detection failed; continuing without it", { err });
    }
  }
```

Change the narration `context.digest` to use `midState`:

```ts
  const context: NarratorContext = {
    systemPrompt: buildSystemPrompt(adventure),
    digest: buildDigest(adventure, midState),
    transcript: windowTranscript(midState.transcript, window),
    input,
  };
```

(Move the `context` construction to after the pre-pass.)

Change narration action processing to start from `midState` and exclude detection-owned types:

```ts
  const actions = processActions(adventure, midState, result.actions, [
    "moveTo",
    "advanceBeat",
  ]);
  const reduced = reduceAll(midState, expandBeatEffects(adventure, midState, actions));
  const footer = exitsFooter(adventure, reduced);
```

**Step 4: Run the full suite**

Run: `npx vitest run src/engine/turnLoop.test.ts`
Expected: PASS (existing + 5 new).

**Step 5: Full gate + commit**

```bash
npx vitest run && npm run typecheck && npm run lint
git add src/engine/turnLoop.ts src/engine/turnLoop.test.ts
git commit -m "Add detection pre-pass to runTurn (movement + beats owned by detection)"
```

---

### Task 6: Real `generateObject` detector

**Files:**
- Modify: `src/llm/registry.ts` (add `createDetector`)
- Test: `src/llm/registry.test.ts`

**Step 1: Write the failing test** (append to `registry.test.ts`)

```ts
import { createDetector } from "./registry.js";
import { vi } from "vitest";

describe("createDetector", () => {
  it("returns move + advancedBeats validated against the per-turn schema", async () => {
    // Stub the AI SDK generateObject via the provider's HTTP call.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            // openai-compatible chat/completions shape the SDK expects for JSON
            choices: [
              { message: { content: JSON.stringify({ move: "north", advancedBeats: [] }) } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const detector = createDetector({
      kind: "openai-compatible",
      baseURL: "http://localhost:9/v1",
      model: "m1",
    });
    const out = await detector.detect({
      input: "go north",
      exits: [{ direction: "north", destination: "Hall" }],
      activeBeats: [],
    });
    expect(out).toEqual({ move: "north", advancedBeats: [] });
  });
});
```

> Note: the exact stubbed response shape depends on the AI SDK version. If
> `generateObject` uses tool/JSON mode, adjust the stub to match what the SDK
> parses (check `node_modules/ai`), or test `createDetector` against a small
> local model in a manual smoke test and keep only the schema/context unit tests
> automated. Do not over-fit the mock to SDK internals.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/registry.test.ts`
Expected: FAIL — `createDetector` not exported.

**Step 3: Implement**

```ts
// src/llm/registry.ts
import { generateObject } from "ai";
import { buildDetectionContext } from "./detection.js"; // (context comes from caller)
import { buildDetectionSchema } from "./detection.js";
import type { Detector, Detection } from "./Detector.js";

const DETECT_TIMEOUT_MS = 8000;

const DETECT_SYSTEM =
  "You extract structured intent from a text-adventure player's command. " +
  "Given the available exits (with destinations) and the active story beats " +
  "(with triggers), decide which exit the player is trying to take (or none) " +
  "and which beats' triggers the command now satisfies. Do not invent exits " +
  "or beats.";

/** Structured detector: one generateObject call against the per-turn schema. */
export function createDetector(config: ProviderConfig): Detector {
  const languageModel = createLanguageModel(config);
  return {
    async detect(ctx): Promise<Detection> {
      const schema = buildDetectionSchema(ctx.exits, ctx.activeBeats);
      const prompt = [
        `Player command: ${ctx.input}`,
        `Exits: ${ctx.exits.map((e) => `${e.direction} -> ${e.destination}`).join(", ") || "(none)"}`,
        `Active beats: ${ctx.activeBeats.map((b) => `${b.id}: ${b.trigger}`).join(" | ") || "(none)"}`,
      ].join("\n");

      const { object } = await generateObject({
        model: languageModel,
        schema,
        system: DETECT_SYSTEM,
        prompt,
        abortSignal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
      });
      // schema already normalized "none" -> null and defaulted advancedBeats.
      return object as Detection;
    },
  };
}
```

> `createLanguageModel` already throws for `openai`/`anthropic` kinds; detection
> shares that limitation with narration until those SDKs are wired.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/registry.test.ts`
Expected: PASS (adjust the mock per the SDK note if needed).

**Step 5: Full gate + commit**

```bash
npx vitest run && npm run typecheck && npm run lint
git add src/llm/registry.ts src/llm/registry.test.ts
git commit -m "Add createDetector (generateObject against the per-turn schema)"
```

---

### Task 7: Remove `moveTo`/`advanceBeat` tools from the narration model

Detection owns them; the narration model should not be offered them.

**Files:**
- Modify: `src/llm/registry.ts` (`createModel`, tool assembly at `registry.ts:118`)
- Test: `src/llm/registry.test.ts` (or `tools.test.ts`)

**Step 1: Write the failing test**

```ts
it("does not expose moveTo or advanceBeat as narration tools", () => {
  // Introspect the tools object the model builds, or assert on NARRATION_TOOL_NAMES.
  expect(NARRATION_TOOL_NAMES).not.toContain("moveTo");
  expect(NARRATION_TOOL_NAMES).not.toContain("advanceBeat");
  expect(NARRATION_TOOL_NAMES).toContain("addItem");
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run src/llm/registry.test.ts`
Expected: FAIL — `NARRATION_TOOL_NAMES` undefined.

**Step 3: Implement** — in `registry.ts`, derive the narration tool set excluding the detection-owned ones:

```ts
import { ACTION_TOOLS } from "./tools.js";

const DETECTION_OWNED = ["moveTo", "advanceBeat"] as const;

export const NARRATION_TOOL_NAMES = (
  Object.keys(ACTION_TOOLS) as (keyof typeof ACTION_TOOLS)[]
).filter((n) => !DETECTION_OWNED.includes(n as (typeof DETECTION_OWNED)[number]));
```

In `createModel`, build `tools` from `NARRATION_TOOL_NAMES` instead of all of `ACTION_TOOLS`:

```ts
      const tools = Object.fromEntries(
        NARRATION_TOOL_NAMES.map((name) => {
          const def = ACTION_TOOLS[name];
          return [name, tool({ description: def.description, parameters: def.parameters, execute: async (args: unknown) => {
            const action = toAction(name, args);
            if (action) actions.push(action);
            return "ok";
          } })];
        }),
      );
```

Also update `buildSystemPrompt` (`turnLoop.ts`) to drop "advance beats" and "move" from the tool list line, since the model no longer has those tools.

**Step 4: Run to verify it passes**

Run: `npx vitest run src/llm/registry.test.ts src/engine/turnLoop.test.ts`
Expected: PASS.

**Step 5: Full gate + commit**

```bash
npx vitest run && npm run typecheck && npm run lint
git add src/llm/registry.ts src/llm/registry.test.ts src/engine/turnLoop.ts
git commit -m "Remove moveTo/advanceBeat from the narration toolset"
```

---

### Task 8: Wire the detector into the runtime (TUI)

**Files:**
- Modify: `src/cli/commands/play.ts`, `src/tui/App.tsx` (`makeModel` sibling `makeDetector`; `runTurn` call at `App.tsx:293`)
- Test: `src/tui/App.test.tsx`

**Step 1: Write the failing test** — extend the App test to pass a `makeDetector` and assert a scripted detected move updates the rendered location. Mirror the existing `makeModel` injection at `App.test.tsx:45`.

```ts
// pass makeDetector={() => new FakeDetector([{ move: "north", advancedBeats: [] }])}
// drive one turn, assert the new room / exits render.
```

**Step 2: Run to verify it fails.**

Run: `npx vitest run src/tui/App.test.tsx`
Expected: FAIL — `makeDetector` prop not accepted / not used.

**Step 3: Implement**

- In `App.tsx`, add a `makeDetector?: (config: ProviderConfig) => Detector` prop, build it lazily beside the model (mirror `buildModel` at `App.tsx:95,123`), and pass `detector` into the `runTurn` deps at `App.tsx:293`:

  ```ts
  const result = await runTurn({ adventure, model, detector }, state, value);
  ```

- In `play.ts`, import `createDetector` from `registry.js` and pass `makeDetector={createDetector}` into the `App` element (beside `makeModel: createModel` at `play.ts:53`).

**Step 4: Run to verify it passes.**

Run: `npx vitest run src/tui/App.test.tsx`
Expected: PASS.

**Step 5: Full gate + commit**

```bash
npx vitest run && npm run typecheck && npm run lint
git add src/cli/commands/play.ts src/tui/App.tsx src/tui/App.test.tsx
git commit -m "Wire the structured detector into the play runtime"
```

---

### Task 9: Manual verification + docs

**Files:**
- Modify: `docs/data-model.md` (note detection owns movement/beats), optionally `README`.

**Steps:**

1. Manual smoke test against a local model:
   ```bash
   xyzzy play examples/cave-of-echoes
   ```
   From the cavern, type `go north` and `go to the lake`; confirm `location`
   changes and the exits footer updates (compare against the old
   `move-failure.json` behavior).
2. Add a short "Action detection" note to `docs/data-model.md` describing the
   detect -> apply -> narrate turn and that movement/beats are engine-owned.
3. Commit:
   ```bash
   git add docs/data-model.md
   git commit -m "Document the action-detection turn flow"
   ```

---

## Verification checklist

- [ ] Detection pre-pass moves the player from a returned direction.
- [ ] Detected beats advance and run their effects.
- [ ] Detection failure/timeout degrades to no move; the turn still completes.
- [ ] Narration model's moveTo/advanceBeat are ignored/absent.
- [ ] Exits footer reflects the post-move room.
- [ ] Per-turn schema rejects invalid directions and beat ids.
- [ ] `npx vitest run && npm run typecheck && npm run lint` all green.
- [ ] Manual: `go north` / `go to the lake` work in `cave-of-echoes`.
