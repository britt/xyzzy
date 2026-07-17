# xyzzy Data Model

This document is the reference for every structure xyzzy reads and writes. All
structures are defined and validated with [zod](https://zod.dev); the schemas in
`world/` are the single source of truth.

Two kinds of data exist:

- **Adventure** — authored, static content that defines a game. You write it.
- **GameState** — a running save, derived from an adventure and mutated during
  play. xyzzy writes it.

Throughout, `Value` means `string | number | boolean`.

---

## Adventure

An adventure lives in `adventure.yaml` (optionally alongside prose files). The
format is **tiered**: only `meta`, `premise`, and `start` are required.
Everything else is optional. Provide as much or as little structure as you want
— the model improvises whatever you leave out. A bare premise plays; a fully
specified world graph plays more deterministically.

```
Adventure
  meta       Meta                required
  premise    string              required
  entities   Entities            optional
  start      Start               required
  beats      StoryBeat[]         optional
```

### Meta

Identifying information for the adventure.

| Field     | Type     | Required | Description                                  |
| --------- | -------- | -------- | -------------------------------------------- |
| `id`      | `string` | yes      | Stable identifier; referenced by save files. |
| `title`   | `string` | yes      | Human-readable title.                        |
| `author`  | `string` | no       | Author name.                                 |
| `version` | `string` | yes      | Adventure version; recorded in saves.        |

### premise

A single string describing the setting, tone, and situation. Always sent to the
model as part of the system prompt. For a minimal adventure this is the entire
world — the model invents rooms, items, and characters as needed.

### Entities

Optional structured world content. Any subsection may be omitted.

```
Entities
  rooms       Room[]        optional
  items       Item[]        optional
  characters  Character[]   optional
```

#### Room

| Field         | Type                  | Required | Description                                      |
| ------------- | --------------------- | -------- | ------------------------------------------------ |
| `id`          | `string`              | yes      | Unique room id.                                  |
| `name`        | `string`              | yes      | Display name.                                    |
| `description` | `string`              | yes      | What the player perceives on entering.           |
| `exits`       | `Record<dir, roomId>` | no       | Map of direction → target room id (e.g. `north`).|

Exit targets are cross-checked by `xyzzy validate` and must resolve to a real
room `id`.

#### Item

| Field         | Type     | Required | Description                                                   |
| ------------- | -------- | -------- | ------------------------------------------------------------- |
| `id`          | `string` | yes      | Unique item id.                                               |
| `name`        | `string` | yes      | Display name.                                                 |
| `description` | `string` | yes      | Item description.                                             |
| `location`    | `string` | no       | Room id where the item starts, or a character id holding it.  |

#### Character

A person, creature, or agent the player can interact with. (Formerly "NPC".)

| Field       | Type                   | Required | Description                                              |
| ----------- | ---------------------- | -------- | -------------------------------------------------------- |
| `id`        | `string`               | yes      | Unique character id.                                     |
| `name`      | `string`               | yes      | Display name.                                            |
| `persona`   | `string`               | yes      | Who they are and how they behave; steers the model.      |
| `location`  | `string`               | no       | Room id where the character starts.                      |
| `history`   | `string[]`             | no       | Short summaries of things that have happened to them.    |
| `state`     | `Record<string, Value>`| no       | Author-defined key → value data for this character.      |

- **`history`** seeds from any entries you author and **grows during play** — the
  engine appends short summaries as events happen (via the
  `appendCharacterHistory` tool-call). It gives the model durable per-character
  memory independent of the transcript window.
- **`state`** is an open bag of author-defined variables, e.g.
  `{ trust: 20, armed: false, mood: "wary" }`. You decide the keys; the engine
  mutates values during play via `setCharacterState`.

### Start

The initial conditions applied when a new game begins.

| Field       | Type                    | Required | Description                                     |
| ----------- | ----------------------- | -------- | ----------------------------------------------- |
| `room`      | `string`                | no       | Starting room id. Omit for freeform location.   |
| `inventory` | `string[]`              | no       | Item ids the player starts with.                |
| `flags`     | `Record<string, Value>` | no       | Initial engine/beat flags.                      |
| `state`     | `Record<string, Value>` | no       | Initial values for the game-wide `state` bag.   |

### StoryBeat

Optional narrative goals that give the story direction. Beats are advanced
during play via the `advanceBeat` action, which the model emits when it judges
the beat's `trigger` satisfied.

| Field         | Type       | Required | Description                                                  |
| ------------- | ---------- | -------- | ------------------------------------------------------------ |
| `id`          | `string`   | yes      | Stable beat id (used by the `beat:<id>` flag).               |
| `description` | `string`   | yes      | Goal shown to the model under "Active goals" until advanced. |
| `trigger`     | `string`   | no       | Natural-language note telling the model _when_ to advance.   |
| `effects`     | `Action[]` | no       | State changes applied automatically when the beat advances.  |

`effects` are pre-authored `Action`s — the same validated mutation vocabulary
the model uses (see § Actions). When the model advances a beat, the engine
applies its effects atomically alongside the `beat:<id>` flag, so a beat's
consequences can never be half-applied. Effects run once: re-advancing an
already-advanced beat is a no-op. They are additive — the model may still emit
its own mutations in the same turn.

---

## GameState

A running save. Separate from the adventure and independently versioned. Written
atomically to `<adventure>/saves/<slot>.json` (autosaved each turn).

```
GameState
  adventureId        string                 which adventure this save belongs to
  adventureVersion   string                 adventure version at save time
  location           roomId | null          player location (null = LLM-tracked)
  inventory          string[]               item ids the player holds
  flags              Record<string, Value>  engine/beat bookkeeping
  state              Record<string, Value>  author-defined game-wide variables
  characters         Record<charId, LiveCharacter>
  turn               number                 turn counter
  transcript         Message[]              full player/narrator history
  createdAt          string                 ISO timestamp
  updatedAt          string                 ISO timestamp
```

### LiveCharacter

The mutable runtime copy of a character, keyed by character id under
`characters`. Seeded from the adventure's `Character` definition, then diverges
as the game progresses.

| Field      | Type                    | Description                                  |
| ---------- | ----------------------- | -------------------------------------------- |
| `location` | `string` (optional)     | Current room id.                             |
| `history`  | `string[]`              | Accumulated event summaries for this character.|
| `state`    | `Record<string, Value>` | Current values of the character's state bag. |

### Message

One entry in the transcript.

| Field   | Type                    | Description                          |
| ------- | ----------------------- | ------------------------------------ |
| `role`  | `"player" \| "narrator"`| Who produced the text.               |
| `text`  | `string`                | The player input or model narration. |
| `turn`  | `number`                | Turn the message belongs to.         |

---

## Open `state` on both game and characters

Both `GameState.state` and each character's `state` are open
`Record<string, Value>` maps. There is **no fixed schema** for their contents —
you define whatever keys your adventure needs and seed them via `start.state`
and character definitions. The engine reads them into the model's context each
turn and mutates them through typed actions. This is how an author customizes
game-wide and per-character bookkeeping without changing xyzzy's schema.

---

## Actions

The model mutates `GameState` only through a fixed set of typed **actions**,
exposed to it as zod-validated tool-calls and applied by a pure reducer
(`(state, action) => state`). Arguments that fail validation are dropped before
the reducer runs, so state can never enter an invalid shape.

| Action                                   | Effect                                             |
| ---------------------------------------- | -------------------------------------------------- |
| `MoveTo(room)`                           | Move the player to a room.                         |
| `AddItem(item)`                          | Add an item to the player's inventory.             |
| `RemoveItem(item)`                       | Remove an item from inventory.                     |
| `SetFlag(key, value)`                    | Set an engine/beat flag.                           |
| `SetGameState(key, value)`               | Set a game-wide `state` value.                     |
| `SetCharacterState(charId, key, value)`  | Set a value in a character's `state`.              |
| `AppendCharacterHistory(charId, summary)`| Append a summary to a character's `history`.       |
| `MoveCharacter(charId, room)`            | Move a character to a room.                        |
| `AdvanceBeat(beatId)`                    | Mark a story beat as advanced.                     |

---

## Turn processing

A turn runs in two phases: **detect → apply → narrate.**

1. **Detect.** A structured detection completion reads the player's input, the
   current room's exits (with destinations), and the active beats (with their
   triggers), and returns `{ move, advancedBeats }` — constrained to a per-turn
   closed-set schema so it can only name a real exit direction or a real beat
   id. The engine turns these into `MoveTo`/`AdvanceBeat` actions and applies
   them (running any beat `effects`) before narration.
2. **Narrate.** The narration model then writes prose against the already-updated
   state. It keeps the item/flag/character actions above but is **not** offered
   `MoveTo` or `AdvanceBeat` — those are owned by detection.

Movement and beat advancement therefore do not depend on the narration model
emitting a tool call, which the local models used here do unreliably. If
detection fails or times out, the turn degrades to no detected move and still
completes. See `docs/plans/2026-07-16-action-detection-design.md`.

A beat's own `effects` are trusted authored content: they are reduced directly
and are **not** run through the undefined-room filter that guards model- and
detection-emitted moves. An effect that moves the player must name a real room.
