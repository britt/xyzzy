# Character Beats and Interactions — Design

## Problem

Story beats today are global: authored once in `adventure.beats`, evaluated
every turn regardless of where the player is, and gone for good once
advanced. Some narrative moments only make sense while a specific character
is on screen — a confession, a bribe, a running joke a character can repeat a
few times. Nothing in the current model lets an author scope a beat to a
character, and nothing supports a beat that can fire more than once.

## Goals

- Let authors attach beats to a character. Like top-level beats, each fires
  at most once.
- Let authors attach interactions to a character: structurally identical to
  beats, but repeatable, with an optional fire limit. No limit means
  unlimited.
- Evaluate a character's beats and interactions only while that character is
  present in the player's current room.
- Keep the triggering mechanism consistent with today's beats: the detection
  pre-pass decides when one fires, not the narration model.

## Data model

`Character` (in `adventure.entities.characters`) gains two optional arrays:

```ts
export const Interaction = StoryBeat.extend({
  limit: z.number().int().positive().optional(),
});
export type Interaction = z.infer<typeof Interaction>;

export const Character = z.object({
  // ...existing fields
  beats: z.array(StoryBeat).optional(),
  interactions: z.array(Interaction).optional(),
});
```

`Interaction` reuses `StoryBeat`'s shape (`id`, `description`, `trigger`,
`effects`) and adds `limit`. Omitting `limit` means the interaction can fire
any number of times.

A beat or interaction id only needs to be unique within its own character's
`beats` or `interactions` array. Two different characters — or a character
and the global `adventure.beats` list — may reuse the same id string without
colliding, because each lives in its own state bag (see below).

## Tracking progress

Progress tracking reuses the exact convention top-level beats already use,
scoped into the character's own state bag instead of the global one:

- A fired character beat sets
  `state.characters[charId].state["beat:<beatId>"] = "advanced"`, mirroring
  `flags["beat:<id>"] = "advanced"`.
- A fired interaction increments
  `state.characters[charId].state["interaction:<interactionId>:count"]`
  (implicitly 0 until first fired).

`LiveCharacter` needs no new fields — it already carries a free-form
`state: ValueBag`, the same shape `GameState.flags` uses.

## Actions and reducer

Two new action types mirror `advanceBeat`:

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

The reducer handles them via the existing `getOrCreateCharacter` /
`withCharacter` helpers:

- `advanceCharacterBeat` sets `char.state["beat:<beatId>"] = "advanced"`.
- `triggerInteraction` reads the current `interaction:<id>:count` (default
  0) and writes `count + 1`.

## Effects expansion

`expandBeatEffects` (in `turnLoop.ts`) gains two branches alongside the
existing `advanceBeat` one:

- **`advanceCharacterBeat`**: if the beat is already advanced
  (`isCharacterBeatAdvanced`), pass the action through unchanged — advancing
  twice is a no-op, same as today's beats. Otherwise look up the beat on
  `adventure.entities.characters.find(c => c.id === charId)?.beats` and
  splice `[...beat.effects, action]` so its effects apply atomically with
  the flag.
- **`triggerInteraction`**: look up the interaction the same way. If it has
  reached its `limit` (`isInteractionExhausted`), drop the action entirely —
  no effects, no count increment, so the count never grows past the limit.
  Otherwise splice `[...interaction.effects, action]`.

Both action types need entries in `ACTION_TOOLS` (`llm/tools.ts`) for
type-completeness — it is a `Record<ActionType, ...>` — and both are
detector-owned, so the narration model is never offered them, matching
`moveTo` and `advanceBeat` today.

That exclusion list currently exists as a duplicated literal array in both
`registry.ts` (`DETECTION_OWNED`) and `turnLoop.ts` (`excluded`). This
change consolidates it into a single exported constant both files import,
so the two new action types can't drift out of sync between them.

## Detector integration

`DetectionContext` gains two candidate lists, built only from characters
present in the player's current room (the same "present" filter
`buildDigest` already applies), and only their not-yet-exhausted beats and
interactions:

```ts
export interface DetectionCharacterBeat {
  charId: string;
  beatId: string;
  trigger: string;
}

export interface DetectionInteraction {
  charId: string;
  interactionId: string;
  trigger: string;
}
```

`Detection` gains matching result fields:
`advancedCharacterBeats: { charId, beatId }[]` and
`triggeredInteractions: { charId, interactionId }[]`.

`buildDetectionContext` computes the present-character list the same way
`buildDigest` does, then collects each present character's beats (filtered
by `!isCharacterBeatAdvanced`) and interactions (filtered by
`!isInteractionExhausted`) into these lists, using `trigger ?? description`
as the trigger text, same as top-level beats.

A beat or interaction id is unique only within one character, but
`buildDetectionSchema`'s structured-output enum is flat. The schema encodes
each candidate as a composite token, `${charId}/${beatId}` (adventure ids
are slugs and won't contain `/`), and the turn loop splits on the first `/`
to recover `{ charId, beatId }` when building the action. Interactions use
the same scheme.

In `turnLoop.ts`'s detection pre-pass, `detection.advancedCharacterBeats`
and `.triggeredInteractions` feed `advanceCharacterBeat` /
`triggerInteraction` actions into the same `detected` array `moveTo` and
`advanceBeat` already use, then flow through `processActions` →
`expandBeatEffects` → `reduceAll` unchanged. `canonicalizeAction` gets cases
for both new types so a model-echoed character name resolves to its id,
matching `setCharacterState`.

## Digest

Each present character's block in `buildDigest` gets a `goals:` sub-list,
parallel to the existing "Active goals" section for global beats, listing
not-yet-advanced beats and not-yet-exhausted interactions:

```
  - Barkeep [barkeep] — gruff, suspicious of strangers
    state: mood=annoyed
    goals:
      - [confess-secret] Admits he watered the ale, if pressed
      - [offer-drink] Offers a free drink (2/3)
```

Interaction lines show `(count/limit)` when a limit is set, and nothing
extra when unlimited.

## Validation

`validateAdventure` gains a duplicate-id check per character: `beats` ids
unique within that character's `beats` array, `interactions` ids unique
within its `interactions` array. Without this check, a duplicate id would
make `.find()` silently resolve only the first match, hiding the second
beat or interaction. No new cross-checks on effect contents — top-level
beat effects don't have that validation either, so this change doesn't add
scope beyond the existing feature.

## Testing

`FakeDetector`'s scripted `Detection` values default the two new fields to
`[]`, so existing tests that construct a `Detection` without them keep
compiling and passing. New tests cover: reducer cases for both actions;
`expandBeatEffects` idempotency (beat) and limit-exhaustion (interaction);
`buildDetectionContext` scoping candidates to present characters only;
`buildDetectionSchema` composite-token round-trip; digest rendering of
character goals; and the validator's duplicate-id check.

## Documentation

`docs/data-model.md` gets a new subsection next to `StoryBeat` describing
`Character.beats` and `Character.interactions`: the location-gating, the
per-character `beat:` / `interaction:<id>:count` tracking convention, and
limit vs. no-limit behavior.
