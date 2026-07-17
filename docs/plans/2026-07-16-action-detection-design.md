# Structured action detection (movement & beats)

**Date:** 2026-07-16
**Status:** Design, ready for implementation plan
**Depends on:** `fix/direction-movement` (PR #4) — reuses `resolveMoveTarget` and the
`moveTo`-to-undefined-room filter.

## Problem

Movement is unreliable. In the `cave-of-echoes/saves/move-failure.json` save the
player issued "go north", "go north motherfucker", and "go to the lake" over
three turns; the narrator described each move, but `location` stayed `cavern` the
whole time. The exits footer reprinted the cavern's exits every turn, and
`lanternLit` was still `false` despite prose describing the lantern being lit.

Root cause: the single narration call both writes prose and drives nine tools,
and the local model narrates state changes without emitting the matching tool
call. No prompt tweak makes a weak model's tool-calling reliable. Movement (and
beat triggers) must not depend on the narration model emitting anything.

## Goals

- "go north" and "go to the lake" always move the player when the exit exists.
- Beat triggers fire reliably from player actions.
- A detection failure degrades to today's behavior, never a broken turn.
- Everything is testable without a live LLM.

## Non-goals (v1)

- Non-adjacent "teleport" jumps.
- Freeform / improvised rooms (`location: null`, no authored exits) — these fall
  back to narration-only, no detected move.
- Separate per-concern calls, tiny-model routing, gating detection by input shape.

## Architecture: two-phase turn

Today: build context -> one narration call (9 tools) -> apply actions -> append
exits -> save.

New: **detect -> apply -> narrate.**

1. **Detect** (structured pre-pass). A new `detect(input, state)` call returns a
   validated object:

   ```ts
   type Detection = { move: string | null; advancedBeats: string[] };
   ```

   It is a `generateObject`-style structured completion — fact extraction against
   a tight, per-turn schema, not free-form tool orchestration.

2. **Apply, then Narrate.** The engine resolves and applies the detected move and
   advances the detected beats (running the beat `effects` already built). The
   narration call then runs against the **updated** state, with `moveTo` and
   `advanceBeat` removed from its toolset.

Detection runs **every turn** — beat triggers can fire off many kinds of action.

## The detection completion

Injectable, so tests fake it (mirroring `FakeNarratorModel`):

```ts
interface Detector {
  detect(ctx: DetectionContext): Promise<Detection>;
}
```

`DetectionContext` carries the player input, the current room's **exits with
their destinations** (`north -> The Still Lake [lake]`), and the **active beats
with their triggers**. It never sees the whole world.

`move` is a **closed set**. The schema is built per turn from the real exits and
active beats:

```ts
z.object({
  move: z.enum([...exitDirections, "none"]).transform(v => v === "none" ? null : v),
  advancedBeats: z.array(z.enum([...activeBeatIds])).default([]),
});
```

Because the enums come from the actual room and beats, the model can only pick a
valid direction or a real beat id; it cannot emit `"north"` when no north exit
exists. That is what makes it reliable where the tool loop was not.

"go to the lake" is handled by showing each exit **with its destination name** in
the prompt, so the extraction maps "the lake" -> the `north` exit; the engine
then resolves `north -> lake` deterministically. Both phrasings collapse to one
closed-set answer.

Beat triggers: the model is asked which active beats' trigger text the input now
satisfies, returning their ids.

Real path: `generateObject` with the per-turn zod schema against the same
provider as narration, bounded by the same `AbortController` timeout pattern used
in `registry.ts`'s `listModels`.

## Applying detections (engine wiring)

In `runTurn`, before narration:

```ts
const detection = await detector.detect({ input, exits, activeBeats });

const detected: Action[] = [];
if (detection.move) detected.push({ type: "moveTo", room: detection.move });
for (const id of detection.advancedBeats) {
  detected.push({ type: "advanceBeat", beatId: id });
}

const canon = detected
  .map(a => canonicalizeAction(adventure, state, a)) // direction -> id
  .filter(isValidMove);                              // existing undefined-room filter
const midState = reduceAll(state, expandBeatEffects(adventure, state, canon));
```

Detection only produces `moveTo` / `advanceBeat` **actions**, which flow through
the existing, tested validation / resolution / effects pipeline. Narration then
runs against `midState`:

```ts
const result = await model.generate({ ...context, digest: buildDigest(adventure, midState) });
const narrationActions = /* validate + canonicalize + filter, as today */;
const finalState = reduceAll(midState, narrationActions);
```

Two `reduceAll` folds, one reducer. The exits footer is computed from
`finalState`, so the player sees the new room's exits — fixing the `move-failure`
symptom. `expandBeatEffects` already skips advanced beats, so a beat named twice
across turns runs its effects once.

Movement no longer depends on the narration model: if `detect` returns
`move: "north"`, the player moves.

## Tool ownership

`moveTo` and `advanceBeat` are **removed** from the narration tool loop.
Detection is the single source of truth for movement and beats. The narration
call keeps `addItem`, `removeItem`, `setFlag`, `setGameState`,
`setCharacterState`, `appendCharacterHistory`, `moveCharacter`. This prevents
two paths from disagreeing (detection moves you north, model also calls
`moveTo`).

## Error handling & degradation

A detection failure must never break a turn:

- `detect` throws or times out -> log a warning, treat as
  `{ move: null, advancedBeats: [] }`, continue to narration. A flaky detector
  degrades to today's behavior, never a crash.
- Off-schema output fails zod validation -> same empty fallback. A hallucinated
  direction or beat id fails the closed-set enum rather than corrupting state.
- The existing `moveTo`-to-undefined-room filter is a second guard, so even a
  valid-looking bad move cannot set `location` to a non-room.
- The detection call is bounded by an `AbortController` timeout, so a hung
  endpoint cannot freeze a turn.

## Testing (TDD, no live LLM)

- `Detector` is injected via `TurnDeps`; a `FakeDetector` returns scripted
  `Detection`s, like `FakeNarratorModel`.
- Engine: detection `move: "north"` -> `location` becomes `lake`; detection beat
  id -> beat advances **and its effects apply**; detection throws -> turn
  completes with no move (degradation); exits footer reflects the new room.
- Schema: per-turn enum rejects a direction with no matching exit and an unknown
  beat id.
- Real `generateObject` detector: a thin unit test with a stubbed `fetch`
  returning a JSON body, mirroring the `config test` tests.

## Future extensions

- Detect more flaky actions (item pickups) via the same pass.
- Per-concern or tiny-model routing if a field proves flaky under measurement.
- Log the per-turn detection + narration actions so this class of bug is
  diagnosable from a save (saves currently store only narration text).
