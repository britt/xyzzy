# Character Beats and Interactions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let adventure authors attach beats (fire once) and interactions (fire repeatedly, with an optional limit) to a specific character, evaluated only while that character is present in the player's current room, triggered by the same detection pre-pass that owns top-level beats today.

**Architecture:** Extend the existing beat machinery — `StoryBeat` schema, `advanceBeat` action, `expandBeatEffects`, and the `Detector` pre-pass — with character-scoped counterparts. Progress is tracked in the character's existing `state` bag using the same `beat:<id>` / new `interaction:<id>:count` key convention `flags` already uses for top-level beats, so no new state shape is needed. Full design rationale: `docs/plans/2026-07-20-character-beats-design.md`.

**Tech Stack:** TypeScript, Zod, Vitest, bun.

---

## Before you start

Read the design doc first: `docs/plans/2026-07-20-character-beats-design.md`. It has the full rationale for every decision below — this plan only has the "what," not the "why."

Run these once to confirm your baseline is green before making any changes:

```bash
bun run typecheck
bun run test
```

Both should pass with no failures. If they don't, stop and report — don't build on a broken baseline.

---

### Task 1: Schema — `Interaction` type and `Character.beats`/`Character.interactions`

**Files:**
- Modify: `src/world/schema.ts:46-83` (the `Character` and `StoryBeat` definitions)
- Test: `src/world/schema.test.ts`

**Step 1: Write the failing tests**

Add to `src/world/schema.test.ts`, inside `describe("Adventure schema", ...)`:

```ts
  it("accepts a character with beats and interactions", () => {
    const parsed = Adventure.parse({
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      entities: {
        characters: [
          {
            id: "barkeep",
            name: "Barkeep",
            persona: "gruff",
            beats: [{ id: "confess", description: "Admits he watered the ale." }],
            interactions: [
              {
                id: "offer-drink",
                description: "Offers a free drink.",
                limit: 3,
              },
            ],
          },
        ],
      },
    });
    const barkeep = parsed.entities?.characters?.[0];
    expect(barkeep?.beats?.[0]?.id).toBe("confess");
    expect(barkeep?.interactions?.[0]).toMatchObject({
      id: "offer-drink",
      limit: 3,
    });
  });

  it("defaults a character's beats and interactions to undefined when omitted", () => {
    const parsed = Adventure.parse({
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      entities: {
        characters: [{ id: "g", name: "Guard", persona: "gruff" }],
      },
    });
    expect(parsed.entities?.characters?.[0]?.beats).toBeUndefined();
    expect(parsed.entities?.characters?.[0]?.interactions).toBeUndefined();
  });

  it("rejects an interaction with a non-positive limit", () => {
    const result = Adventure.safeParse({
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
      entities: {
        characters: [
          {
            id: "g",
            name: "Guard",
            persona: "gruff",
            interactions: [{ id: "x", description: "d", limit: 0 }],
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/world/schema.test.ts`
Expected: FAIL — `beats`/`interactions`/`limit` aren't recognized keys yet (or the parse succeeds but strips them, so the `.toBe`/`.toMatchObject` assertions fail).

**Step 3: Write the implementation**

In `src/world/schema.ts`, add the `Interaction` schema right after `StoryBeat` (after line 83), and add `beats`/`interactions` to `Character`:

```ts
export const Interaction = StoryBeat.extend({
  /** Max number of times this interaction may fire. Omitted = unlimited. */
  limit: z.number().int().positive().optional(),
});
export type Interaction = z.infer<typeof Interaction>;
```

Then update the `Character` definition (currently `src/world/schema.ts:46-54`):

```ts
export const Character = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  persona: z.string().min(1),
  location: z.string().optional(),
  history: z.array(z.string()).default([]),
  state: ValueBag.default({}),
  /** Beats scoped to this character; each fires at most once. */
  beats: z.array(StoryBeat).optional(),
  /** Repeatable beats scoped to this character; see {@link Interaction.limit}. */
  interactions: z.array(Interaction).optional(),
});
export type Character = z.infer<typeof Character>;
```

`Interaction` must be declared after `StoryBeat` (it extends it) but before `Character` (which references it).

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/world/schema.test.ts`
Expected: PASS (all tests in the file, including the three new ones)

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/world/schema.ts src/world/schema.test.ts
git commit -m "Add Interaction type and character-scoped beats/interactions to schema"
```

---

### Task 2: Actions — `advanceCharacterBeat`, `triggerInteraction`, and the shared detection-owned list

**Files:**
- Modify: `src/world/actions.ts`
- Test: `src/world/schema.test.ts` (the `describe("Action schema", ...)` block)

**Step 1: Write the failing tests**

Add to `src/world/schema.test.ts`, inside `describe("Action schema", ...)`:

```ts
  it("validates advanceCharacterBeat and triggerInteraction", () => {
    expect(
      Action.safeParse({
        type: "advanceCharacterBeat",
        charId: "barkeep",
        beatId: "confess",
      }).success,
    ).toBe(true);
    expect(
      Action.safeParse({
        type: "triggerInteraction",
        charId: "barkeep",
        interactionId: "offer-drink",
      }).success,
    ).toBe(true);
  });
```

Also add a new file `src/world/actions.test.ts` (there isn't one yet — action *validation* is covered in `schema.test.ts`, but `DETECTION_OWNED_ACTIONS` is a plain export worth its own direct test):

```ts
import { describe, expect, it } from "vitest";
import { DETECTION_OWNED_ACTIONS } from "./actions.js";

describe("DETECTION_OWNED_ACTIONS", () => {
  it("lists exactly the action types the detection pre-pass owns", () => {
    expect([...DETECTION_OWNED_ACTIONS].sort()).toEqual(
      [
        "moveTo",
        "advanceBeat",
        "advanceCharacterBeat",
        "triggerInteraction",
      ].sort(),
    );
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/world/schema.test.ts src/world/actions.test.ts`
Expected: FAIL — `advanceCharacterBeat`/`triggerInteraction` aren't valid action types yet, and `actions.test.ts` fails to import `DETECTION_OWNED_ACTIONS` (doesn't exist).

**Step 3: Write the implementation**

In `src/world/actions.ts`, add two new action schemas after `AdvanceBeat` (currently lines 58-61):

```ts
export const AdvanceCharacterBeat = z.object({
  type: z.literal("advanceCharacterBeat"),
  charId: z.string(),
  beatId: z.string(),
});

export const TriggerInteraction = z.object({
  type: z.literal("triggerInteraction"),
  charId: z.string(),
  interactionId: z.string(),
});
```

Add both to the `Action` discriminated union:

```ts
export const Action = z.discriminatedUnion("type", [
  MoveTo,
  AddItem,
  RemoveItem,
  SetFlag,
  SetGameState,
  SetCharacterState,
  AppendCharacterHistory,
  MoveCharacter,
  AdvanceBeat,
  AdvanceCharacterBeat,
  TriggerInteraction,
]);
```

At the bottom of the file (after `export type ActionType = ...`), add the shared detection-owned list — this consolidates what were two separately-maintained literal arrays (`registry.ts`'s `DETECTION_OWNED` and `turnLoop.ts`'s inline `excluded`) into one source of truth:

```ts
/**
 * Action types the detection pre-pass decides and applies before narration —
 * never offered to the narration model as a tool. Shared by `llm/registry.ts`
 * (which filters narration tools) and `engine/turnLoop.ts` (which filters
 * narration-model output) so the two can't drift out of sync.
 */
export const DETECTION_OWNED_ACTIONS: readonly ActionType[] = [
  "moveTo",
  "advanceBeat",
  "advanceCharacterBeat",
  "triggerInteraction",
];
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/world/schema.test.ts src/world/actions.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/world/actions.ts src/world/actions.test.ts src/world/schema.test.ts
git commit -m "Add advanceCharacterBeat/triggerInteraction actions and shared detection-owned list"
```

---

### Task 3: Reducer — apply the two new actions

**Files:**
- Modify: `src/engine/reducer.ts:59-63` (right after the `advanceBeat` case)
- Test: `src/engine/reducer.test.ts`

**Step 1: Write the failing tests**

Add to `src/engine/reducer.test.ts`, inside `describe("reduce", ...)`, after the existing `"advanceBeat records an advanced beat flag"` test:

```ts
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
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/engine/reducer.test.ts`
Expected: FAIL — `assertNever` throws "Unhandled action" for both new types (the reducer's `default` case).

**Step 3: Write the implementation**

In `src/engine/reducer.ts`, add two cases right after the existing `case "advanceBeat":` block (currently lines 59-63):

```ts
    case "advanceCharacterBeat": {
      const char = getOrCreateCharacter(state, action.charId);
      return withCharacter(state, action.charId, {
        ...char,
        state: { ...char.state, [`beat:${action.beatId}`]: "advanced" },
      });
    }

    case "triggerInteraction": {
      const char = getOrCreateCharacter(state, action.charId);
      const key = `interaction:${action.interactionId}:count`;
      const count = typeof char.state[key] === "number" ? char.state[key] : 0;
      return withCharacter(state, action.charId, {
        ...char,
        state: { ...char.state, [key]: count + 1 },
      });
    }
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/engine/reducer.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/engine/reducer.ts src/engine/reducer.test.ts
git commit -m "Handle advanceCharacterBeat and triggerInteraction in the reducer"
```

---

### Task 4: Digest — advancement/exhaustion helpers and per-character goals

**Files:**
- Modify: `src/engine/digest.ts`
- Test: `src/engine/digest.test.ts`

**Step 1: Write the failing tests**

Replace the adventure fixture at the top of `src/engine/digest.test.ts` (currently lines 6-36) so `grimble` has a beat and a limited interaction — change the `characters` array entry to:

```ts
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
```

Add new tests, e.g. after the existing `"lists active beats and hides advanced ones"` test:

```ts
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
    expect(exhausted).not.toContain("goals:");
  });
```

Add a new `describe` block at the bottom for the new exported helpers:

```ts
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
```

Update the test file's imports to add `isCharacterBeatAdvanced, interactionCount, isInteractionExhausted`.

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/engine/digest.test.ts`
Expected: FAIL — the three new exports don't exist yet, and the digest doesn't render a `goals:` line for characters.

**Step 3: Write the implementation**

In `src/engine/digest.ts`, add the import for `Interaction` and the three new exported helpers, right after the existing `isBeatAdvanced`:

```ts
import type { Adventure, GameState, Interaction, Value } from "../world/schema.js";

/** A character beat is active until its `beat:<id>` key in that character's own
 * state bag reads "advanced" — the same convention `isBeatAdvanced` uses for
 * the global `flags` bag, scoped per character. */
export function isCharacterBeatAdvanced(
  state: GameState,
  charId: string,
  beatId: string,
): boolean {
  return state.characters[charId]?.state[`beat:${beatId}`] === "advanced";
}

/** How many times a character's interaction has fired so far. */
export function interactionCount(
  state: GameState,
  charId: string,
  interactionId: string,
): number {
  const value = state.characters[charId]?.state[`interaction:${interactionId}:count`];
  return typeof value === "number" ? value : 0;
}

/** True once an interaction has fired `limit` times. An interaction with no
 * `limit` can never be exhausted. */
export function isInteractionExhausted(
  state: GameState,
  charId: string,
  interaction: Interaction,
): boolean {
  if (interaction.limit === undefined) return false;
  return interactionCount(state, charId, interaction.id) >= interaction.limit;
}
```

Then, in `buildDigest`, inside the `--- Characters present ---` loop (currently around lines 66-77), add a goals block after the `history` line:

```ts
  if (present.length) {
    lines.push("Characters here:");
    for (const c of present) {
      const live = state.characters[c.id];
      const st = live ? renderBag(live.state) : renderBag(c.state);
      lines.push(`  - ${c.name} [${c.id}] — ${c.persona.trim()}`);
      lines.push(`    state: ${st}`);
      const history = live?.history ?? c.history;
      if (history.length) {
        lines.push(`    history: ${history.join("; ")}`);
      }
      const activeBeats = (c.beats ?? []).filter(
        (b) => !isCharacterBeatAdvanced(state, c.id, b.id),
      );
      const activeInteractions = (c.interactions ?? []).filter(
        (i) => !isInteractionExhausted(state, c.id, i),
      );
      if (activeBeats.length || activeInteractions.length) {
        lines.push("    goals:");
        for (const b of activeBeats) {
          lines.push(`      - [${b.id}] ${b.description.trim()}`);
        }
        for (const i of activeInteractions) {
          const suffix =
            i.limit !== undefined
              ? ` (${interactionCount(state, c.id, i.id)}/${i.limit})`
              : "";
          lines.push(`      - [${i.id}] ${i.description.trim()}${suffix}`);
        }
      }
    }
  }
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/engine/digest.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/engine/digest.ts src/engine/digest.test.ts
git commit -m "Add character beat/interaction tracking helpers and digest goals rendering"
```

---

### Task 5: Detector — character-scoped candidates and composite-token encoding

**Files:**
- Modify: `src/llm/Detector.ts`
- Modify: `src/llm/detection.ts`
- Test: `src/llm/detection.test.ts`

**Step 1: Write the failing tests**

Replace the whole contents of `src/llm/detection.test.ts` with (this rewrites the file to cover the new params/fields; existing assertions are preserved, just extended):

```ts
import { describe, expect, it } from "vitest";
import {
  buildDetectionSchema,
  buildDetectionContext,
  decodeToken,
  encodeToken,
} from "./detection.js";
import type { Adventure } from "../world/schema.js";
import { newGameState } from "../engine/state.js";

const exits = [{ direction: "north", destination: "The Still Lake" }];
const beats = [{ id: "find-light", trigger: "player lights the lantern" }];
const characterBeats = [
  { charId: "barkeep", beatId: "confess", trigger: "player presses the barkeep" },
];
const interactions = [
  { charId: "barkeep", interactionId: "offer-drink", trigger: "player is friendly" },
];

describe("encodeToken / decodeToken", () => {
  it("round-trips a charId + id pair", () => {
    expect(decodeToken(encodeToken("barkeep", "confess"))).toEqual({
      charId: "barkeep",
      id: "confess",
    });
  });
});

describe("buildDetectionSchema", () => {
  it("accepts a valid direction and beat id", () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(
      schema.parse({ move: "north", advancedBeats: ["find-light"] }),
    ).toEqual({
      move: "north",
      advancedBeats: ["find-light"],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    });
  });

  it('maps "none" to a null move and defaults advancedBeats', () => {
    const schema = buildDetectionSchema(exits, beats);
    expect(schema.parse({ move: "none" })).toEqual({
      move: null,
      advancedBeats: [],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
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
    expect(schema.parse({ move: "none" })).toEqual({
      move: null,
      advancedBeats: [],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    });
  });

  it("accepts a character beat token and decodes it to charId/beatId", () => {
    const schema = buildDetectionSchema([], [], characterBeats, []);
    expect(
      schema.parse({ move: "none", advancedCharacterBeats: ["barkeep/confess"] }),
    ).toMatchObject({
      advancedCharacterBeats: [{ charId: "barkeep", beatId: "confess" }],
    });
  });

  it("rejects a character beat token not in the candidate list", () => {
    const schema = buildDetectionSchema([], [], characterBeats, []);
    expect(
      schema.safeParse({ move: "none", advancedCharacterBeats: ["ghost/nope"] })
        .success,
    ).toBe(false);
  });

  it("accepts an interaction token and decodes it to charId/interactionId", () => {
    const schema = buildDetectionSchema([], [], [], interactions);
    expect(
      schema.parse({ move: "none", triggeredInteractions: ["barkeep/offer-drink"] }),
    ).toMatchObject({
      triggeredInteractions: [{ charId: "barkeep", interactionId: "offer-drink" }],
    });
  });
});

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: { room: "cavern" },
  entities: {
    rooms: [
      { id: "cavern", name: "The Great Cavern", description: "d", exits: { north: "lake" } },
      { id: "lake", name: "The Still Lake", description: "d" },
    ],
    characters: [
      {
        id: "barkeep",
        name: "Barkeep",
        persona: "gruff",
        location: "cavern",
        beats: [{ id: "confess", description: "d", trigger: "player presses the barkeep" }],
        interactions: [
          { id: "offer-drink", description: "d", trigger: "player is friendly" },
        ],
      },
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

  it("lists a present character's beats and interactions", () => {
    const ctx = buildDetectionContext(adventure, newGameState(adventure, "c"), "hi");
    expect(ctx.characterBeats).toEqual([
      { charId: "barkeep", beatId: "confess", trigger: "player presses the barkeep" },
    ]);
    expect(ctx.interactions).toEqual([
      { charId: "barkeep", interactionId: "offer-drink", trigger: "player is friendly" },
    ]);
  });

  it("omits a character's beats/interactions when the character is not present", () => {
    const state = { ...newGameState(adventure, "c"), location: "lake" };
    const ctx = buildDetectionContext(adventure, state, "hi");
    expect(ctx.characterBeats).toEqual([]);
    expect(ctx.interactions).toEqual([]);
  });

  it("omits an already-advanced character beat and an exhausted interaction", () => {
    const state = {
      ...newGameState(adventure, "c"),
      characters: {
        barkeep: {
          location: "cavern",
          history: [],
          state: { "beat:confess": "advanced", "interaction:offer-drink:count": 999 },
        },
      },
    };
    // offer-drink has no `limit` in this fixture, so it is never exhausted —
    // only the beat should disappear.
    const ctx = buildDetectionContext(adventure, state, "hi");
    expect(ctx.characterBeats).toEqual([]);
    expect(ctx.interactions).toEqual([
      { charId: "barkeep", interactionId: "offer-drink", trigger: "player is friendly" },
    ]);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/llm/detection.test.ts`
Expected: FAIL — `encodeToken`/`decodeToken` don't exist, `buildDetectionSchema` doesn't accept a 3rd/4th argument or return the two new fields, `buildDetectionContext` doesn't return `characterBeats`/`interactions`.

**Step 3: Write the implementation**

In `src/llm/Detector.ts`, add the two new candidate/result shapes and extend `DetectionContext`/`Detection`:

```ts
/** One active character beat visible to the detector: character + beat id + trigger. */
export interface DetectionCharacterBeat {
  charId: string;
  beatId: string;
  trigger: string;
}

/** One active character interaction visible to the detector. */
export interface DetectionInteraction {
  charId: string;
  interactionId: string;
  trigger: string;
}

export interface DetectionContext {
  input: string;
  exits: DetectionExit[];
  activeBeats: DetectionBeat[];
  /** Beats belonging to characters present in the current room. */
  characterBeats: DetectionCharacterBeat[];
  /** Interactions belonging to characters present in the current room. */
  interactions: DetectionInteraction[];
}

export interface Detection {
  /** exit direction (or null) the player is trying to take */
  move: string | null;
  /** ids of active beats whose triggers the input now satisfies */
  advancedBeats: string[];
  /** character beats whose triggers the input now satisfies */
  advancedCharacterBeats: { charId: string; beatId: string }[];
  /** character interactions whose triggers the input now satisfies */
  triggeredInteractions: { charId: string; interactionId: string }[];
}
```

Update `FakeDetector`'s default so scripted `Detection` values without the new fields still satisfy the interface:

```ts
    const next =
      this.queue[this.index] ??
      this.queue[this.queue.length - 1] ??
      ({
        move: null,
        advancedBeats: [],
        advancedCharacterBeats: [],
        triggeredInteractions: [],
      } satisfies Detection);
```

In `src/llm/detection.ts`, add the token helpers near the top:

```ts
const TOKEN_SEPARATOR = "/";

/** Encode a `{charId, id}` pair as a single enum-safe token. Character and
 * beat/interaction ids in this codebase are slugs and won't contain `/`. */
export function encodeToken(charId: string, id: string): string {
  return `${charId}${TOKEN_SEPARATOR}${id}`;
}

/** Inverse of {@link encodeToken}: split on the first separator only, so an
 * id containing `/` (unlikely, but not schema-forbidden) round-trips. */
export function decodeToken(token: string): { charId: string; id: string } {
  const i = token.indexOf(TOKEN_SEPARATOR);
  return { charId: token.slice(0, i), id: token.slice(i + 1) };
}
```

Update the imports at the top of `detection.ts` to add the new types and the two digest helpers:

```ts
import { isBeatAdvanced, isCharacterBeatAdvanced, isInteractionExhausted } from "../engine/digest.js";
import type {
  DetectionBeat,
  DetectionCharacterBeat,
  DetectionContext,
  DetectionExit,
  DetectionInteraction,
} from "./Detector.js";
```

Replace `buildDetectionSchema` with a version that accepts the two new (optional, defaulted) candidate lists and returns the two new result fields:

```ts
export function buildDetectionSchema(
  exits: DetectionExit[],
  activeBeats: DetectionBeat[],
  characterBeats: DetectionCharacterBeat[] = [],
  interactions: DetectionInteraction[] = [],
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

  const charBeatTokens = characterBeats.map((b) => encodeToken(b.charId, b.beatId));
  const advancedCharacterBeats = (
    charBeatTokens.length > 0
      ? z.array(z.enum(charBeatTokens as [string, ...string[]])).default([])
      : z.array(z.never()).default([])
  ).transform((tokens) =>
    tokens.map((t) => {
      const { charId, id } = decodeToken(t);
      return { charId, beatId: id };
    }),
  );

  const interactionTokens = interactions.map((i) => encodeToken(i.charId, i.interactionId));
  const triggeredInteractions = (
    interactionTokens.length > 0
      ? z.array(z.enum(interactionTokens as [string, ...string[]])).default([])
      : z.array(z.never()).default([])
  ).transform((tokens) =>
    tokens.map((t) => {
      const { charId, id } = decodeToken(t);
      return { charId, interactionId: id };
    }),
  );

  return z.object({ move, advancedBeats, advancedCharacterBeats, triggeredInteractions });
}
```

Update `buildDetectionContext` to compute the present-character candidate lists (mirroring `buildDigest`'s `present` filter) and include them in the returned context:

```ts
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

  const characters = adventure.entities?.characters ?? [];
  const present = characters.filter(
    (c) => (state.characters[c.id]?.location ?? c.location) === state.location,
  );

  const characterBeats: DetectionCharacterBeat[] = present.flatMap((c) =>
    (c.beats ?? [])
      .filter((b) => !isCharacterBeatAdvanced(state, c.id, b.id))
      .map((b) => ({
        charId: c.id,
        beatId: b.id,
        trigger: (b.trigger ?? b.description).trim(),
      })),
  );

  const interactions: DetectionInteraction[] = present.flatMap((c) =>
    (c.interactions ?? [])
      .filter((i) => !isInteractionExhausted(state, c.id, i))
      .map((i) => ({
        charId: c.id,
        interactionId: i.id,
        trigger: (i.trigger ?? i.description).trim(),
      })),
  );

  return { input, exits, activeBeats, characterBeats, interactions };
}
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/llm/detection.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/llm/Detector.ts src/llm/detection.ts src/llm/detection.test.ts
git commit -m "Detect character-scoped beats and interactions for present characters"
```

---

### Task 6: turnLoop — expand effects, canonicalize, and wire the detection pre-pass

**Files:**
- Modify: `src/engine/turnLoop.ts`
- Test: `src/engine/turnLoop.test.ts`

**Step 1: Write the failing tests**

Add to `src/engine/turnLoop.test.ts`. First, extend the `withBeats` fixture's imports (add `isCharacterBeatAdvanced`/`isInteractionExhausted` are NOT needed here — only `turnLoop`/`state` exports are), then add a character with a beat and a limited interaction to a new fixture, and add tests inside `describe("expandBeatEffects", ...)`:

```ts
  const withCharacterBeats: Adventure = {
    meta: { id: "a", title: "A", version: "1" },
    premise: "p",
    start: { room: "start" },
    entities: {
      characters: [
        {
          id: "barkeep",
          name: "Barkeep",
          persona: "gruff",
          beats: [
            {
              id: "confess",
              description: "Confesses.",
              effects: [{ type: "setFlag", key: "knowsSecret", value: true }],
            },
          ],
          interactions: [
            {
              id: "offer-drink",
              description: "Offers a drink.",
              limit: 1,
              effects: [{ type: "addItem", item: "ale" }],
            },
          ],
        },
      ],
    },
  };

  it("inserts a character beat's effects before the advanceCharacterBeat action", () => {
    const state = newGameState(withCharacterBeats, "c");
    expect(
      expandBeatEffects(withCharacterBeats, state, [
        { type: "advanceCharacterBeat", charId: "barkeep", beatId: "confess" },
      ]),
    ).toEqual([
      { type: "setFlag", key: "knowsSecret", value: true },
      { type: "advanceCharacterBeat", charId: "barkeep", beatId: "confess" },
    ]);
  });

  it("does not reapply a character beat's effects once advanced", () => {
    const state = {
      ...newGameState(withCharacterBeats, "c"),
      characters: {
        barkeep: { location: undefined, history: [], state: { "beat:confess": "advanced" } },
      },
    };
    expect(
      expandBeatEffects(withCharacterBeats, state, [
        { type: "advanceCharacterBeat", charId: "barkeep", beatId: "confess" },
      ]),
    ).toEqual([{ type: "advanceCharacterBeat", charId: "barkeep", beatId: "confess" }]);
  });

  it("inserts an interaction's effects before the triggerInteraction action while under its limit", () => {
    const state = newGameState(withCharacterBeats, "c");
    expect(
      expandBeatEffects(withCharacterBeats, state, [
        { type: "triggerInteraction", charId: "barkeep", interactionId: "offer-drink" },
      ]),
    ).toEqual([
      { type: "addItem", item: "ale" },
      { type: "triggerInteraction", charId: "barkeep", interactionId: "offer-drink" },
    ]);
  });

  it("drops a triggerInteraction action entirely once its limit is reached", () => {
    const state = {
      ...newGameState(withCharacterBeats, "c"),
      characters: {
        barkeep: {
          location: undefined,
          history: [],
          state: { "interaction:offer-drink:count": 1 },
        },
      },
    };
    expect(
      expandBeatEffects(withCharacterBeats, state, [
        { type: "triggerInteraction", charId: "barkeep", interactionId: "offer-drink" },
      ]),
    ).toEqual([]);
  });
```

Add tests for `canonicalizeAction` inside `describe("canonicalizeAction", ...)`:

```ts
  it("resolves a character name to its id for advanceCharacterBeat and triggerInteraction", () => {
    const withChar: Adventure = {
      ...adventure,
      entities: { ...adventure.entities, characters: [{ id: "g", name: "The Guard", persona: "p", history: [], state: {} }] },
    };
    expect(
      canonicalizeAction(withChar, atStart, {
        type: "advanceCharacterBeat",
        charId: "The Guard",
        beatId: "confess",
      }),
    ).toEqual({ type: "advanceCharacterBeat", charId: "g", beatId: "confess" });
    expect(
      canonicalizeAction(withChar, atStart, {
        type: "triggerInteraction",
        charId: "The Guard",
        interactionId: "offer-drink",
      }),
    ).toEqual({ type: "triggerInteraction", charId: "g", interactionId: "offer-drink" });
  });
```

Finally, find the existing test at line ~429, `"ignores moveTo/advanceBeat emitted by the narration model (detection owns them)"`, read it in full (`sed -n '420,470p' src/engine/turnLoop.test.ts` or open the file around there) to see its exact shape, then add a sibling test asserting the same for the two new types — a `FakeNarratorModel` that emits `advanceCharacterBeat`/`triggerInteraction` actions directly, run through `runTurn` with a `FakeDetector` configured, and assert the resulting state shows none of their effects applied (i.e., they were dropped because the detector owns them, and the detector wasn't scripted to trigger them).

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/engine/turnLoop.test.ts`
Expected: FAIL — `expandBeatEffects` doesn't yet expand character beat/interaction actions, `canonicalizeAction` doesn't yet resolve `charId` for the two new types, and (once you add it) the narration-model-ignores test fails because the two new types aren't excluded yet.

**Step 3: Write the implementation**

In `src/engine/turnLoop.ts`, update the `isBeatAdvanced` import to add the two new digest helpers:

```ts
import { buildDigest, isBeatAdvanced, isCharacterBeatAdvanced, isInteractionExhausted } from "./digest.js";
```

Add cases to `canonicalizeAction`'s switch (alongside `setCharacterState`/`appendCharacterHistory`, currently lines 73-76):

```ts
    case "advanceCharacterBeat":
      return { ...action, charId: resolveRef(chars, action.charId) };
    case "triggerInteraction":
      return { ...action, charId: resolveRef(chars, action.charId) };
```

Rewrite `expandBeatEffects` to branch on all three beat-like action types:

```ts
export function expandBeatEffects(
  adventure: Adventure,
  state: GameState,
  actions: Action[],
): Action[] {
  return actions.flatMap((action) => {
    if (action.type === "advanceBeat") {
      if (isBeatAdvanced(state, action.beatId)) return [action];
      const beat = adventure.beats?.find((b) => b.id === action.beatId);
      return [...(beat?.effects ?? []), action];
    }

    if (action.type === "advanceCharacterBeat") {
      if (isCharacterBeatAdvanced(state, action.charId, action.beatId)) return [action];
      const char = adventure.entities?.characters?.find((c) => c.id === action.charId);
      const beat = char?.beats?.find((b) => b.id === action.beatId);
      return [...(beat?.effects ?? []), action];
    }

    if (action.type === "triggerInteraction") {
      const char = adventure.entities?.characters?.find((c) => c.id === action.charId);
      const interaction = char?.interactions?.find((i) => i.id === action.interactionId);
      if (!interaction) return [action];
      if (isInteractionExhausted(state, action.charId, interaction)) return [];
      return [...(interaction.effects ?? []), action];
    }

    return [action];
  });
}
```

Update its doc comment (currently above the function) to mention all three action types instead of only `advanceBeat`.

In `runTurn`, extend the detection pre-pass to push the two new action kinds (right after the existing `for (const id of detection.advancedBeats)` loop):

```ts
      for (const id of detection.advancedBeats) {
        detected.push({ type: "advanceBeat", beatId: id });
      }
      for (const { charId, beatId } of detection.advancedCharacterBeats) {
        detected.push({ type: "advanceCharacterBeat", charId, beatId });
      }
      for (const { charId, interactionId } of detection.triggeredInteractions) {
        detected.push({ type: "triggerInteraction", charId, interactionId });
      }
```

Replace the hardcoded exclusion list with the shared constant. Add the import:

```ts
import { Action, DETECTION_OWNED_ACTIONS } from "../world/actions.js";
```

(This replaces the existing `import { Action } from "../world/actions.js";`.) Then change:

```ts
  const excluded: ReadonlyArray<Action["type"]> = deps.detector
    ? ["moveTo", "advanceBeat"]
    : [];
```

to:

```ts
  const excluded: ReadonlyArray<Action["type"]> = deps.detector
    ? DETECTION_OWNED_ACTIONS
    : [];
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/engine/turnLoop.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/engine/turnLoop.ts src/engine/turnLoop.test.ts
git commit -m "Wire character beats/interactions through expandBeatEffects and the detection pre-pass"
```

---

### Task 7: Narration tool registry — `ACTION_TOOLS` entries

**Files:**
- Modify: `src/llm/tools.ts:57-60` (right after the `advanceBeat` tool def)
- Test: `src/llm/tools.test.ts`

**Step 1: Write the failing test**

Add to `src/llm/tools.test.ts`:

```ts
  it("has a tool definition for the character-scoped action types", () => {
    expect(ACTION_TOOLS.advanceCharacterBeat).toBeDefined();
    expect(ACTION_TOOLS.triggerInteraction).toBeDefined();
  });
```

**Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/llm/tools.test.ts`
Expected: FAIL — TypeScript won't even compile yet, since `ACTION_TOOLS` is typed `Record<ActionType, ActionToolDef>` and is missing two required keys (this will show as a build/typecheck error, not just a runtime assertion failure).

**Step 3: Write the implementation**

In `src/llm/tools.ts`, add two entries to `ACTION_TOOLS` right after `advanceBeat` (currently lines 57-60):

```ts
  advanceCharacterBeat: {
    description: "Mark a character-scoped story beat as advanced.",
    parameters: z.object({ charId: z.string(), beatId: z.string() }),
  },
  triggerInteraction: {
    description: "Fire a repeatable character interaction.",
    parameters: z.object({ charId: z.string(), interactionId: z.string() }),
  },
```

**Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/llm/tools.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/llm/tools.ts src/llm/tools.test.ts
git commit -m "Register ACTION_TOOLS entries for character beats and interactions"
```

---

### Task 8: Registry — use the shared detection-owned list, extend the detector prompt

**Files:**
- Modify: `src/llm/registry.ts`
- Test: `src/llm/registry.test.ts`

**Step 1: Write the failing tests**

Update the "full-set assertion" test in `describe("NARRATION_TOOL_NAMES", ...)` (currently lines 74-92) — the excluded-names assertion needs the two new types added:

```ts
  it("excludes moveTo, advanceBeat, advanceCharacterBeat, and triggerInteraction (owned by detection)", () => {
    expect(NARRATION_TOOL_NAMES).not.toContain("moveTo");
    expect(NARRATION_TOOL_NAMES).not.toContain("advanceBeat");
    expect(NARRATION_TOOL_NAMES).not.toContain("advanceCharacterBeat");
    expect(NARRATION_TOOL_NAMES).not.toContain("triggerInteraction");
  });
```

(The "keeps exactly the other narration mutation tools" test right below it does not need to change — it already lists the seven names that remain, and none of those are affected.)

Update the `createDetector` test (currently lines 95-119) to pass the new context fields and assert the prompt mentions them:

```ts
describe("createDetector", () => {
  it("returns the validated object from a schema + context-built prompt", async () => {
    const mocked = generateObject as unknown as ReturnType<typeof vi.fn>;
    mocked.mockResolvedValue({
      object: {
        move: "north",
        advancedBeats: [],
        advancedCharacterBeats: [],
        triggeredInteractions: [],
      },
    });

    const detector = createDetector(config);
    const out = await detector.detect({
      input: "go north",
      exits: [{ direction: "north", destination: "Hall" }],
      activeBeats: [{ id: "reach-hall", trigger: "player reaches the hall" }],
      characterBeats: [
        { charId: "guard", beatId: "confess", trigger: "player presses the guard" },
      ],
      interactions: [
        { charId: "guard", interactionId: "salute", trigger: "player salutes" },
      ],
    });

    expect(out).toEqual({
      move: "north",
      advancedBeats: [],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    });

    expect(mocked).toHaveBeenCalledTimes(1);
    const call = mocked.mock.calls[0]![0] as { schema: unknown; prompt: string };
    expect(call.schema).toBeDefined();
    const prompt = String(call.prompt);
    expect(prompt).toContain("go north");
    expect(prompt).toContain("north -> Hall");
    expect(prompt).toContain("reach-hall");
    expect(prompt).toContain("guard/confess");
    expect(prompt).toContain("guard/salute");
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/llm/registry.test.ts`
Expected: FAIL — `NARRATION_TOOL_NAMES` still contains the two new types (registry.ts's local `DETECTION_OWNED` hasn't been updated), and the `createDetector` test's context object fails to typecheck (missing fields) / the prompt doesn't mention `characterBeats`/`interactions` yet.

**Step 3: Write the implementation**

In `src/llm/registry.ts`, replace the local `DETECTION_OWNED` constant and its usage with the shared one. Remove:

```ts
/** Action types the detection pre-pass owns; not offered to the narration model. */
const DETECTION_OWNED = ["moveTo", "advanceBeat"] as const;
```

Add to the imports:

```ts
import { DETECTION_OWNED_ACTIONS } from "../world/actions.js";
```

Update `NARRATION_TOOL_NAMES`:

```ts
export const NARRATION_TOOL_NAMES = (
  Object.keys(ACTION_TOOLS) as (keyof typeof ACTION_TOOLS)[]
).filter((n) => !DETECTION_OWNED_ACTIONS.includes(n));
```

Update `DETECT_SYSTEM` (currently lines 195-200) to mention character beats/interactions:

```ts
const DETECT_SYSTEM =
  "You extract structured intent from a text-adventure player's command. " +
  "Given the available exits (with destinations), the active story beats " +
  "(with triggers), and any beats or interactions belonging to characters " +
  "currently in the scene (with triggers), decide which exit the player is " +
  "trying to take (or none), which beats' triggers the command now " +
  "satisfies, and which character beats/interactions it triggers. Do not " +
  "invent exits, beats, characters, or interactions.";
```

Update `createDetector`'s `detect` implementation to pass the new context fields through to `buildDetectionSchema` and include them in the prompt:

```ts
    async detect(ctx): Promise<Detection> {
      const schema = buildDetectionSchema(
        ctx.exits,
        ctx.activeBeats,
        ctx.characterBeats,
        ctx.interactions,
      );
      const prompt = [
        `Player command: ${ctx.input}`,
        `Exits: ${
          ctx.exits.map((e) => `${e.direction} -> ${e.destination}`).join(", ") ||
          "(none)"
        }`,
        `Active beats: ${
          ctx.activeBeats.map((b) => `${b.id}: ${b.trigger}`).join(" | ") ||
          "(none)"
        }`,
        `Character beats: ${
          ctx.characterBeats
            .map((b) => `${b.charId}/${b.beatId}: ${b.trigger}`)
            .join(" | ") || "(none)"
        }`,
        `Character interactions: ${
          ctx.interactions
            .map((i) => `${i.charId}/${i.interactionId}: ${i.trigger}`)
            .join(" | ") || "(none)"
        }`,
      ].join("\n");
```

The rest of `createDetector` (the `generateObject` call and `return object;`) is unchanged.

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/llm/registry.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/llm/registry.ts src/llm/registry.test.ts
git commit -m "Wire character beats/interactions into the detector prompt and schema"
```

---

### Task 9: Validator — duplicate id checks per character

**Files:**
- Modify: `src/world/validator.ts:87-94` (the `characters.forEach` block)
- Test: `src/world/validator.test.ts`

**Step 1: Write the failing tests**

Add to `src/world/validator.test.ts`, inside `describe("checkCrossReferences", ...)`:

```ts
  it("flags a character with a duplicate beat id", () => {
    const issues = checkCrossReferences(
      base({
        entities: {
          characters: [
            {
              id: "g",
              name: "G",
              persona: "p",
              history: [],
              state: {},
              beats: [
                { id: "confess", description: "d" },
                { id: "confess", description: "d again" },
              ],
            },
          ],
        },
      }),
    );
    expect(issues).toEqual([
      {
        path: "entities.characters[0].beats[1].id",
        message: 'duplicate beat id "confess"',
      },
    ]);
  });

  it("flags a character with a duplicate interaction id", () => {
    const issues = checkCrossReferences(
      base({
        entities: {
          characters: [
            {
              id: "g",
              name: "G",
              persona: "p",
              history: [],
              state: {},
              interactions: [
                { id: "chat", description: "d" },
                { id: "chat", description: "d again" },
              ],
            },
          ],
        },
      }),
    );
    expect(issues).toEqual([
      {
        path: "entities.characters[0].interactions[1].id",
        message: 'duplicate interaction id "chat"',
      },
    ]);
  });

  it("allows a beat and an interaction on the same character to share an id", () => {
    const issues = checkCrossReferences(
      base({
        entities: {
          characters: [
            {
              id: "g",
              name: "G",
              persona: "p",
              history: [],
              state: {},
              beats: [{ id: "shared", description: "d" }],
              interactions: [{ id: "shared", description: "d" }],
            },
          ],
        },
      }),
    );
    expect(issues).toHaveLength(0);
  });
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/world/validator.test.ts`
Expected: FAIL — no duplicate-id checks exist yet, so `issues` is empty for the first two new tests.

**Step 3: Write the implementation**

In `src/world/validator.ts`, extend the `characters.forEach` block (currently lines 87-94):

```ts
  characters.forEach((char, ci) => {
    if (char.location !== undefined && !roomIds.has(char.location)) {
      issues.push({
        path: `entities.characters[${ci}].location`,
        message: `unknown room "${char.location}"`,
      });
    }

    const beatIds = new Set<string>();
    (char.beats ?? []).forEach((beat, bi) => {
      if (beatIds.has(beat.id)) {
        issues.push({
          path: `entities.characters[${ci}].beats[${bi}].id`,
          message: `duplicate beat id "${beat.id}"`,
        });
      }
      beatIds.add(beat.id);
    });

    const interactionIds = new Set<string>();
    (char.interactions ?? []).forEach((interaction, ii) => {
      if (interactionIds.has(interaction.id)) {
        issues.push({
          path: `entities.characters[${ci}].interactions[${ii}].id`,
          message: `duplicate interaction id "${interaction.id}"`,
        });
      }
      interactionIds.add(interaction.id);
    });
  });
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/world/validator.test.ts`
Expected: PASS

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/world/validator.ts src/world/validator.test.ts
git commit -m "Flag duplicate character beat/interaction ids during validation"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/data-model.md`

**Step 1: Write the section**

In `docs/data-model.md`, right after the existing `### StoryBeat` section (currently lines 115-134, ending with the paragraph about effects being additive), add:

```markdown
### Character beats and interactions

`Character` entities may declare their own `beats` and `interactions` —
narrative moments scoped to that character instead of the whole adventure.

| Field          | Type            | Required | Description                                                        |
| -------------- | --------------- | -------- | -------------------------------------------------------------------- |
| `beats`        | `StoryBeat[]`   | no       | Character-scoped beats. Each fires at most once, like a top-level beat. |
| `interactions` | `Interaction[]` | no       | Repeatable beats. `Interaction` is `StoryBeat` plus an optional `limit`. |

A beat or interaction id only needs to be unique within its own character's
`beats`/`interactions` list — two different characters (or a character and
the top-level `beats` list) may reuse the same id without colliding.

**Scoping.** A character's beats and interactions are only candidates for
advancement while that character is present in the player's current room.
They never fire off-screen.

**Triggering.** Exactly like top-level beats, the detection pre-pass — not
the narration model — decides when a character beat advances
(`advanceCharacterBeat`) or an interaction fires (`triggerInteraction`).
Effects apply atomically with the advancement, the same way top-level beat
effects do.

**Tracking.** Progress reuses the flag convention top-level beats already
use, scoped into the character's own state bag instead of the global one:

- A fired beat sets `state.characters[charId].state["beat:<id>"] = "advanced"`.
- A fired interaction increments
  `state.characters[charId].state["interaction:<id>:count"]`.

**Limits.** An `Interaction` with no `limit` can fire an unlimited number of
times. Once a limit is reached, the interaction is dropped from detection
candidates and any further `triggerInteraction` for it is a no-op — the
count is never incremented past the limit and effects don't reapply.
```

**Step 2: Verify**

Read the file back to confirm the new section reads correctly in context (heading level matches sibling `###` sections, table renders, no broken markdown).

**Step 3: Commit**

```bash
git add docs/data-model.md
git commit -m "Document character beats and interactions"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

**Step 1: Run the full suite**

```bash
bun run typecheck
bun run test
bun run lint
```

Expected: all three pass with no errors or warnings.

**Step 2: Spot-check the example adventure (optional but recommended)**

`examples/cave-of-echoes` doesn't need a character beat to prove the feature works (that's what the unit tests are for), but if you want an end-to-end sanity check, add a `beats:` or `interactions:` entry to one of its characters under `examples/cave-of-echoes/characters/`, then run:

```bash
bun run dev -- play cave-of-echoes
```

and confirm the digest shows a `goals:` line for that character when you're in their room. Revert the example-adventure edit afterward — it's just a manual smoke test, not part of the feature.

**Step 3: Final commit (if anything was left uncommitted)**

```bash
git status
```

Expected: clean tree — every task above already committed its own changes.
