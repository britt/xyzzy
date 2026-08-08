# Issue 21: game-state inspection while playing — implementation plan

**Issue:** https://github.com/britt/xyzzy/issues/21

## Restated acceptance criteria

1. With a session live, `e` is not offered and editing is unreachable from the sidebar, for every category.
2. The right pane splits: gameplay above, inspector below, while a session is live and the sidebar (not play) has focus.
3. Focusing play (`p`) collapses the inspector back to full-pane gameplay; `Escape` back to the sidebar restores the split.
4. A new `Game State` category appears directly below `Adventure Config` and inspects the full `GameState`.
5. Selecting a room / character / beat / item while a session is live shows its *runtime* state (not its authored definition), updating as turns are taken.
6. The screen still fits the terminal exactly, and both panels scroll independently within their own row budgets.

## Assumptions (narrowest reading of the open questions)

- **Sidebar visibility**: authoring categories stay visible during play; only the *content* they show switches from authored fields to runtime inspection, and editing is disabled. Nothing is hidden.
- **Game State reachability when idle**: the category is always present (fixed sidebar order, like `config`/`logs`). With no live session it shows a dim placeholder line rather than being unreachable — consistent with how every other "nothing set yet" field in this pane already renders (see `renderFields.ts`'s placeholder convention).
- **Inspector follows selection, not the player**: does not auto-jump to the player's current room as they move. Selecting a category/entity is a deliberate action already wired for authoring; changing that would be new interaction design out of scope for this issue.
- **Split is fixed**, not user-adjustable (roughly half the content pane's rows each way, play never dropping below its existing chrome minimum). An adjustable split is a separate enhancement.
- **Items' runtime location**: per the issue's own note, `GameState` has no per-item location — only `inventory`. The inspector reports "in inventory" or falls back to the authored `location`. Adding item location to `GameState` itself is out of scope (a schema/reducer change, not a TUI change).

## Design

### New pure module: `src/tui/dev/inspectFields.ts`

Sibling to `renderFields.ts`, same `FieldRow` output type, but reads `(adventure, gameState, id)` instead of an authored entity:

- `inspectGameStateFields(adventure, state: GameState | null): FieldRow[]` — full dump: location (resolved to room name), turn, inventory, flags, state, per-character summary. Placeholder row when `state` is `null`.
- `inspectRoomFields(adventure, state: GameState, roomId): FieldRow[]` — player-here yes/no, characters here (by live `location`), authored items here.
- `inspectCharacterFields(adventure, state: GameState, characterId): FieldRow[]` — live `location` (contrasted with the authored one when they differ), `history`, fired beats (`state["beat:<id>"] === "advanced"`), interaction counts (`state["interaction:<id>:count"]`).
- `inspectBeatFields(adventure, state: GameState, beatId): FieldRow[]` — fired yes/no via `flags["beat:<id>"] === "advanced"`.
- `inspectItemFields(adventure, state: GameState, itemId): FieldRow[]` — "in inventory" or the authored location.
- `inspectFieldsFor(category, adventure, state, entry: CatalogEntry): FieldRow[]` — dispatcher mirroring `renderFieldsFor`.

### `entityCatalog.ts`

Add `"gamestate"` to the `Category` union, inserted in `CATEGORIES` directly after `"config"`. `CATEGORY_LABELS.gamestate = "Game State"`. `entriesForCategory` returns `[]` for it (no entity list, like `config`/`logs`).

### `App.tsx`

Add `onStateChange?: (state: GameState) => void`, invoked everywhere `setState` currently runs (post-turn, post-`/load`) so an embedding parent can mirror the live state without owning it.

### `DevApp.tsx`

- New state `liveGameState: GameState | null`, set alongside `playState` in `startPlay` and cleared alongside it in `onQuit`; kept current via `onStateChange={setLiveGameState}` passed to `<App>`.
- `fieldRows` dispatch gains two branches: `category === "gamestate"` → `inspectGameStateFields`; and, when `hasLiveSession` is true, every entity-bearing category routes through `inspectFieldsFor` instead of `renderFieldsFor`. `logs` and `config` are unaffected by `hasLiveSession` (logs already read-only; config's authored view stays visible, just not editable).
- Content-pane rendering: when `playState` is live, keep `<App>` mounted at a stable position in the tree at all times (never remount it on focus change — that would drop its internal turn state) with a wrapping `Box` whose height/props change instead of its existence. When focus is `"sidebar"`, add a divider + inspector panel as trailing siblings, sized via a new `layout.ts` helper.
- `e` is gated on `!hasLiveSession` in addition to the existing checks.

### `layout.ts`

New `splitContentPane(layout): { playRows, inspectorRows } | undefined` and a small helper to shrink the play viewport to `playRows` instead of the full content pane. Same "undefined when terminal size unknown" convention as `playViewport`.

### `hotkeys.ts`

`e` gated on `!hasLiveSession` (currently only gated on `!isLogsCategory`). `hasLiveSession` already exists on `HotKeyContext`.

## Existing-test fallout

Inserting `"gamestate"` between `"config"` and `"beats"` shifts every category's Tab-index by one. `DevApp.test.tsx` has several tests/helpers that reach a category via a fixed count of Tab presses assuming the current order (`toRooms`, `toCharacters`, a few inline loops and single `\t` presses that expect to land on `Beats`). These get their counts bumped by one. Tests that reach a category via `CATEGORIES.length` (the `logs` helpers) are already order-independent and need no change.

## Task order

1. `entityCatalog.ts` + test — add `gamestate` category.
2. `inspectFields.ts` + test — new pure renderers (TDD, RED/GREEN per function).
3. `layout.ts` + test — split-pane row budget.
4. `hotkeys.ts` + test — gate `e` on `hasLiveSession` globally.
5. `App.tsx` + test — `onStateChange` prop.
6. `DevApp.tsx` + test — wire it all together; fix the Tab-index fallout in `DevApp.test.tsx`.
7. Full suite, build, lint.
8. Verification (Scenario 12, `VERIFICATION_PLAN.md`) — requires a real TTY; run manually or note the limitation.
