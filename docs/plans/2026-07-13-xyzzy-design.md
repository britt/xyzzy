# xyzzy — Design

A TypeScript toolkit for authoring and playing LLM-driven text adventures
against local models. Ships as a single CLI (`xyzzy`) with an Ink-rendered TUI
for play.

- **Stack:** Node 20+, TypeScript (ESM, strict), `tsup` build, `vitest`,
  `commander`, `ink` (+ `ink-text-input`, `ink-spinner`), `ai` (Vercel AI SDK)
  + providers, `zod`, `yaml`.
- **Repo:** `britt/xyzzy`.

## Architecture

Layers depend downward, keeping the core testable without a model or terminal.

```
cli/         commander entrypoint → play | new | validate | config
  └─ tui/    Ink components (play screen: scrollback + input line, spinner, status)
  └─ engine/ turn loop, game-state reducer, save/load, transcript management
  └─ llm/    provider registry (pluggable) + AI SDK wiring + tool-call layer
  └─ world/  zod schemas, adventure loader/validator, scaffolder
  └─ config/ provider config store (~/.config/xyzzy) + per-adventure config
```

Key seams:

- **`llm/`** exposes a narrow `NarratorModel` interface from a provider
  registry. Everything above depends on the interface, never a concrete SDK
  call, so tests inject a fake model.
- **`engine/`** owns the turn loop: takes player input + `GameState`, calls the
  model with the transcript and zod-typed tools, applies resulting mutations
  through a pure reducer, returns narration + new state.
- **`world/`** is the schema authority — the zod types are the single source of
  truth shared by loader, validator, and scaffolder.

## Data Model

The world format is **hybrid/tiered**: one zod schema where structure is
optional. An author can sketch a premise or fully specify a world graph in the
same file, validated the same way. A minimum valid adventure is
`meta` + `premise` + `start`; the LLM improvises what isn't authored.

### Adventure (`adventure.yaml` + optional prose)

```
Adventure
  meta:      { id, title, author, version }
  premise:   string                         # setting + tone, always fed to model
  entities?:
    rooms?:  Room[]        # { id, name, description, exits: {dir → roomId} }
    items?:  Item[]        # { id, name, description, location }
    characters?: Character[]
  start:     { room?, inventory?, flags?, state? }
  beats?:    StoryBeat[]                     # optional narrative goals/triggers
```

### Character

```
Character
  id, name
  persona:   string                 # who they are / how they behave
  location?: roomId
  history:   string[]               # short summaries of what's happened to them
  state:     Record<string, Value>  # author-configurable key → value
```

`Value = string | number | boolean`. `history` seeds from authored entries and
grows during play (engine appends short summaries via a tool-call). `state` is
freeform per-character data (e.g. `{ trust: 20, armed: false, mood: "wary" }`).

### GameState (save file, versioned)

```
GameState
  adventureId, adventureVersion
  location:   roomId | null
  inventory:  string[]
  flags:      Record<string, Value>       # engine/beat bookkeeping
  state:      Record<string, Value>       # author-configurable game-wide vars
  characters: Record<charId, { location?, history, state }>  # live character data
  turn:       number
  transcript: Message[]                    # full player/narrator history
  createdAt, updatedAt
```

Both the game and each character carry an open `state: Record<string, Value>`
that authors define however they like, seeded from `start.state` / character
definitions and mutated during play.

### Reducer

Pure `(state, action) => state`, exhaustively tested. Actions (emitted as
zod-typed tool-calls):

`MoveTo`, `AddItem`, `RemoveItem`, `SetFlag`, `SetGameState(key,val)`,
`SetCharacterState(charId,key,val)`, `AppendCharacterHistory(charId,summary)`,
`MoveCharacter(charId,room)`, `AdvanceBeat`.

## LLM Layer & Turn Loop

### Provider registry (pluggable)

`llm/` exposes a `NarratorModel` the engine depends on. A registry maps a
provider `kind` from config to an AI SDK `LanguageModel`:

```
kind: "openai-compatible"    → createOpenAICompatible({ baseURL, apiKey? })
                               # default; Ollama / LM Studio / llama.cpp / vLLM
kind: "ollama"               → ollama community provider
kind: "openai" | "anthropic" → cloud (optional escape hatch)
```

Config picks `{ kind, baseURL, model, ...opts }`. Adding a provider is one
registry entry.

### Turn loop (one player input = one turn)

1. Build model context: system prompt (premise + tone + rules) + a compact
   **state digest** (current room, visible entities, inventory, relevant
   character `state`/`history`, active beats) + recent transcript.
2. Call the model via AI SDK `generateText` with **zod-typed tools** (the
   reducer actions). Use the SDK's multi-step tool loop so the model can narrate
   and emit several state mutations in one turn.
3. Collect tool-calls → validate args with zod → fold through the pure reducer
   to produce the next `GameState`.
4. The model's final text = narration shown to the player; append player input +
   narration to `transcript`.
5. Persist state (autosave) and return `{ narration, state }` to the TUI.

**Context management:** state lives in the structured digest (authoritative), so
the transcript can be windowed/trimmed without losing game facts — the digest is
regenerated from `GameState` each turn.

**Determinism/testing:** a fake `NarratorModel` returns scripted tool-calls +
text, exercising the full loop and reducer with zero network.

## CLI & TUI

CLI is thin (`commander`): parse args, resolve config, delegate to a lib
function. No game logic.

```
xyzzy play <path> [--save <slot>] [--provider <name>]   # launch Ink TUI
xyzzy new  <name>                                        # scaffold adventure
xyzzy validate <path>                                    # zod-check, report, exit code
xyzzy config ...                                         # manage providers
```

- **new** — writes a minimal valid adventure (`adventure.yaml`), a `saves/`
  dir, a `README`, and a commented example room/character. Refuses to overwrite.
- **validate** — parses against the zod schema, prints human-readable errors with
  paths (`entities.rooms[2].exits.north → unknown room "attic"`), including
  cross-reference checks. Non-zero exit on failure — CI-friendly.
- **config** — `list`, `add`, `use <name>`, `test` (ping endpoint). Reads/writes
  the provider store.

TUI (Ink, only `xyzzy play`):

```
┌ title · room · turn N ──────────────┐   status bar
│ (scrollback: narration + player      │
│  input echoed, newest at bottom)     │
├──────────────────────────────────────┤
│ > _                                   │   input line (TextInput)
└──────────────────────────────────────┘
   ⠋ thinking…            spinner while model runs
```

- Player types a command → input disabled + spinner → engine runs turn →
  narration streams/appends → autosave → input re-enabled.
- **Streaming:** narration streams token-by-token; tool-calls apply after the
  stream resolves.
- **Meta commands** intercepted before the model: `/save [slot]`, `/load [slot]`,
  `/quit`, `/help`, `/state` (dump state for debugging).
- The Ink app is a thin view over engine state; a fake model tests it.

## Config, Error Handling & Testing

### Config store

Global providers at `~/.config/xyzzy/config.json` (zod-validated): a named
provider map + a default. Per-adventure `xyzzy.config.json` may override
model/provider. Resolution: `--provider` flag → adventure config → global
default. Secrets (cloud keys) read from env, never written to disk.

### Error handling — fail loud at the boundary, degrade gracefully in play

- **Load/validate:** zod errors with offending path + cross-ref checks;
  `validate` exits non-zero, `play` refuses to start on an invalid adventure.
- **Provider/connection:** a failed model call surfaces in the TUI as a
  non-fatal error line — the turn is rolled back (state commits only after
  tool-calls validate), input re-enabled, no corrupt save.
- **Malformed tool-calls:** args failing zod validation are dropped with a
  logged warning; the reducer never sees invalid actions (defense-in-depth). A
  turn producing zero valid narration is retried once, then reported.
- **Saves:** written atomically (temp file + rename); a corrupt/old-version save
  is detected on load and reported, never silently reset.

### Testing (TDD)

- **Unit:** reducer (every action + edge cases), zod schemas (valid/invalid
  fixtures), config resolution, validate cross-ref logic.
- **Integration:** full turn loop against a fake `NarratorModel` returning
  scripted text + tool-calls — asserts state transitions, autosave,
  rollback-on-error. Zero network.
- **TUI:** `ink-testing-library` with a fake model — asserts scrollback, input,
  spinner, meta-commands.
- **No live-LLM tests in CI**; an optional manual smoke script hits a real local
  endpoint.
