# `xyzzy dev` — Multi-Pane Development TUI — Design

## Problem

Authoring an adventure today means hand-editing YAML files scattered across
`rooms/`, `items/`, `characters/`, `beats/`, and `adventure.yaml` itself,
with no single view of what's defined, and no way to test a change without
leaving the editor, remembering the right `xyzzy play` invocation, and
losing your place. There's also no visibility into which entities currently
fail validation without running `xyzzy validate` separately.

## Goals

- One command, `xyzzy dev <path>`, that shows every defined entity (rooms,
  items, characters, beats) and the adventure's own config, browsable
  without scrolling through unrelated entity types to find one.
- Select an entity to see its fields rendered in a large scrollable pane.
- Edit the underlying file in `$EDITOR` without leaving the tool; reload and
  re-validate automatically on return.
- Play-test the adventure — from a new game or an existing save — from
  inside the same session, then return to editing exactly where you left
  off.

## Non-goals

- Editing fields directly in the TUI (no in-app form for entity fields —
  `$EDITOR` is the only write path, consistent with the project's
  "YAML is the source of truth" approach also taken by `newEntity`).
- Recovering a partially-broken `adventure.yaml` into a partially-browsable
  state. `xyzzy dev` requires a fully valid adventure to start, same as
  `xyzzy play`.
- Live file-watching. The tool only reloads after an `$EDITOR` session
  closes.

## Entry point

`xyzzy dev <path>` (new `src/cli/commands/dev.ts`, wired into
`src/cli/index.ts` alongside `play`/`validate`). Requires a real TTY, same
constraint `play` already has via Ink.

Startup calls `loadAdventure(path)` exactly as `play.ts` does. If it throws
`AdventureLoadError`, print the formatted issues to stderr and exit
non-zero — `xyzzy dev` never opens on an invalid adventure. This keeps
startup identical to `play`'s existing refusal behavior; no new parsing
logic is needed for a "degraded" mode.

Provider resolution also happens once up front (`resolveProvider`, as
`play.ts` does), so entering play-focus mode later doesn't need to
re-resolve it.

## Layout

Two panes: a left sidebar (fixed width) and a right content pane (flexible
width), built with the same `Box`/`flexDirection` conventions `App.tsx`
already uses — no new layout library.

The left sidebar has two stacked sections:

1. A fixed **category selector**, always visible, in this exact order:
   `Adventure Config`, `Beats`, `Characters`, `Rooms`, `Items`.
2. Below it, the **entity list for whichever category is currently
   active** — the order entities appear in matches `loadAdventure`'s
   file-scan order (from `loader.ts`), i.e. inline `adventure.yaml`
   entries first, then conventional-directory files.

```
Adventure Config
Beats
Characters
Rooms          ← active category
Items
─────────────
  Cavern
  Old Cistern  ⚠
  Grotto
```

`▶ Play` is not part of the category cycle — it's reached via the `p`
hotkey from anywhere in the tool (see Play-focus mode below).

**Navigation**:
- `Tab` / `Shift+Tab` cycles the active category (wrapping through the 5).
- `↑` / `↓` (and `j`/`k`) move the selection within the active category's
  entity list; moving updates the content pane immediately — no separate
  confirm step.
- `e` opens the currently selected entity's file in `$EDITOR`.
- `p` enters play-focus mode (see below).
- `q` quits the tool.
- A footer help line mirrors `App.tsx`'s existing `HELP` text convention:
  `Tab switch category · ↑↓ navigate · e edit · p play · q quit`.

`Adventure Config` has no entity list beneath it (or a single implicit
"Config" row) — selecting that category shows `adventure.yaml`'s own
fields directly in the content pane.

## Content pane — rendered fields

Not raw YAML. Each kind renders its schema fields as labeled rows, echoing
the `ENTITY_FIELDS` grouping already defined in `entityWriter.ts`:

- **Room**: Name, Description, then a read-only `Exits` block rendered from
  the real `exits` map.
- **Item**: Name, Description, Location.
- **Character**: Name, Persona, Location, plus read-only blocks for
  History, State, Beats.
- **Beat**: `id` (no Name field — beats don't have one), Description,
  Trigger, plus a read-only Effects block.
- **Adventure Config**: `meta.title`, `meta.id`, `premise`, and any other
  top-level scalar fields `adventure.yaml` defines.

Unset optional fields render as dim placeholder text, matching the
`# key: <placeholder>` convention `entityWriter.ts` already uses for
scaffolded files — same visual language, different medium (dim text vs.
YAML comment).

Structural fields (Exits, History, State, Beats, Effects) are always
read-only display, never editable here — consistent with `entityWriter`'s
existing design decision that only scalar fields are promptable/editable
by tooling; structural fields are hand-edited YAML only.

## Editing flow

`e` shells out to `$EDITOR` via `spawnSync` with inherited stdio on the
selected entity's actual file path (reusing `entityFilePath`-style
resolution from `entityWriter.ts` rather than re-deriving paths), the same
way a real terminal editor needs raw TTY control. `DevApp` takes this as an
injected `openEditor: (path: string) => void` prop (mirroring how
`play.ts` injects `makeModel`/`makeDetector`) so tests can substitute a
fake instead of shelling out for real.

On return from `$EDITOR`, `xyzzy dev` calls `loadAdventure(adventureDir)`
again in full — cheap enough at adventure scale, and correctness-safe for
cross-reference validation (e.g. an edited room's exit pointing at another
room) that a single-file reload can't catch.

- **Reload succeeds**: `adventure` state is replaced; the content pane and
  tree re-render from fresh data; any previous `⚠` on that entity clears.
- **Reload fails** (`AdventureLoadError`): the previous good `adventure`
  object is kept in memory (so every *other* entity keeps rendering
  normally) and the failure is recorded against the file/entity that was
  just edited. The content pane shows an inline error banner (file path +
  issue text, from `formatIssues`) in place of the rendered view, and the
  tree marks that row with `⚠`. The rest of the tool stays interactive —
  you can switch category, browse, and edit other files while one entity
  is broken.

Mapping a formatted validation issue back to a specific `(kind, id)` for
the tree glyph needs a small helper — issues are already path-qualified
strings (e.g. `entities.rooms[...].exits.down → ...`), so this is string
parsing, not new validation logic.

## Play-focus mode

- `p` (from anywhere) or an explicit "Play" trigger opens a small **inline
  submenu** in the content pane: "New Game" plus every existing save slot
  (via `listSaves(adventureDir)`), navigated with `↑`/`↓`, chosen with
  `Enter`.
- Choosing an option seeds `GameState` the same way `play.ts` does today
  (`newGameState` for a fresh start, `loadGame` to resume a slot), then the
  content pane mounts an **embedded instance of the existing `App`
  component** (`src/tui/App.tsx`) with the same props `play.ts` already
  assembles. `App.tsx` itself needs no changes — it's just rendered inside
  a narrower `Box` instead of full terminal width.
- Entering play-focus shifts keyboard input to the embedded `App`; the
  category selector and entity list stop receiving input but remain
  visible and unchanged in the left sidebar.
- **Escape** returns focus to the tree/category sidebar. The embedded
  `App` instance stays mounted with its state intact (turn count,
  scrollback, busy/spinner state) — it just stops receiving keystrokes.
  Pressing `p` again re-focuses that same live instance rather than
  restarting a new one.
- `App`'s `/quit` calls `useApp().exit()`, which today tears down the
  whole Ink root. Embedded inside `DevApp`, that's wrong — quitting play
  should unmount just the embedded instance and return the content pane to
  whatever entity was selected before Play was entered, not exit the
  process. `DevApp` needs to pass its own unmount callback through instead
  of relying on `App`'s root-level `exit()` behavior — likely a small prop
  addition to `App.tsx` (an optional `onQuit` override) or a wrapper that
  intercepts the `/quit` meta command's effect. This is the one real
  integration wrinkle in the whole design.
- Autosave during embedded play still writes to `adventureDir/saves/`, so
  `/save` and `/load` inside the embedded session behave identically to
  standalone `xyzzy play`.

## State (`DevApp`)

`DevApp` (new: `src/tui/DevApp.tsx`) owns:

- `adventure: Adventure` — the current, last-successfully-loaded adventure.
- `activeCategory: "config" | "beats" | "characters" | "rooms" | "items"`.
- `selectedIndex` per category (so switching categories and back preserves
  the previous selection).
- `playSession: { state: GameState; provider: ProviderConfig; ... } | null`
  — `null` until Play is first entered; persists across Escape.
- `focus: "sidebar" | "play"`.
- `issues: Map<string, ValidationIssue[]>` keyed by `(kind, id)` — powers
  the `⚠` glyphs and the inline error banner.

## Testing

Per this repo's TDD rules, every module gets a co-located test file written
first:

- A small pure helper in `entityWriter.ts` (or a new sibling module) for
  resolving an entity's file path and for mapping a formatted validation
  issue string back to `(kind, id)` — both unit-testable without fs or Ink.
- `DevApp.tsx` tested with `ink-testing-library`, following the existing
  pattern in `src/tui/App.test.tsx` (fake model, `type()` helper,
  tick-based rendering). Cases: category switching via Tab, entity
  selection updating the content pane, `e` invoking the injected
  `openEditor` fake, reload-success clearing an existing `⚠`,
  reload-failure setting the banner + glyph without disturbing other
  entities, play-focus mount via `p`/submenu selection, Escape returning
  focus while keeping the session alive, and `/quit` inside the embedded
  session unmounting only that instance.
- `$EDITOR` invocation itself (real `spawnSync`) is not unit-tested — no
  real editor in CI — verified only via a new end-to-end scenario.
- New `VERIFICATION_PLAN.md` scenario, real TTY + real `$EDITOR` + real
  files, following Scenario 5's pattern: launch `xyzzy dev` against a
  scratch copy of `examples/cave-of-echoes`, switch categories, edit a
  room's description, confirm the reload reflects it, break a file to
  confirm the `⚠`/banner path, enter Play, take a turn, `/save`, Escape,
  confirm the sidebar is still browsable, re-enter Play, `/quit`, then quit
  the whole tool.

## Documentation

`README.md` gets a new `xyzzy dev` section: command usage, the pane
layout, keybindings, and a note that entity edits go through `$EDITOR`
rather than in-app forms.
