# `xyzzy dev` Multi-Pane Development TUI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `xyzzy dev <path>`, an Ink TUI for browsing every defined entity (rooms, items, characters, beats) plus the adventure's own config, viewing each as rendered fields in a content pane, editing the underlying file in `$EDITOR` with automatic reload/validation, and play-testing (new game or resume a save) embedded in the same session without losing your place.

**Architecture:** Two pure, Ink-free modules (`entityCatalog.ts` for the sidebar's category/entity listing, `renderFields.ts` for the content pane's field rows) feed a new `DevApp.tsx` Ink component. `DevApp` reuses the existing `App.tsx` play component unmodified except two small embeddability props (`onQuit`, `inputActive`), mounting it directly inside its own content pane for play-focus mode rather than building a second play implementation. A new `src/cli/commands/dev.ts` mirrors `play.ts`'s orchestration (load adventure, resolve provider, render, wait, exit). Full design rationale: `docs/plans/2026-07-27-dev-tool-tui-design.md`.

**Tech Stack:** TypeScript, React, Ink 5, ink-testing-library, Zod, Vitest, bun.

---

## Before you start

Read the design doc first: `docs/plans/2026-07-27-dev-tool-tui-design.md`. It has the full rationale for every decision below — this plan only has the "what," not the "why."

One deliberate refinement from the design doc: the design doc describes a generic "map a formatted validation issue path back to `(kind, id)`" helper for the tree's `⚠` glyph. This plan implements something simpler and more robust instead — since editing always happens on a specific, already-known entity (you press `e` on a specific tree row), the reload logic just re-validates the whole adventure and, on failure, attributes *all* current issues to *the entity that was just edited* (keyed by `kind:id`), rather than parsing zod/cross-reference path strings generically. This avoids fragile string parsing and is simpler to test, at the cost of not attributing a cross-reference issue to the *other* entity it might really be about (e.g. deleting a room that a different room's exit still points to shows the `⚠` on the room you edited, not the one with the dangling exit). That tradeoff is fine for a v1 — flag it to the developer if you disagree.

Run these once to confirm your baseline is green before making any changes:

```bash
bun run typecheck
bun run test
```

Both should pass with no failures. If they don't, stop and report — don't build on a broken baseline.

---

### Task 1: `entityCatalog.ts` — sidebar category/entity data model

**Files:**
- Create: `src/tui/dev/entityCatalog.ts`
- Test: `src/tui/dev/entityCatalog.test.ts`

**Step 1: Write the failing tests**

Create `src/tui/dev/entityCatalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_LABELS, entriesForCategory } from "./entityCatalog.js";
import type { Adventure } from "../../world/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: {},
  entities: {
    rooms: [{ id: "cavern", name: "Cavern", description: "d" }],
    items: [{ id: "key", name: "Key", description: "d" }],
    characters: [{ id: "hermit", name: "Hermit", persona: "p", history: [], state: {} }],
  },
  beats: [{ id: "won-the-key", description: "d" }],
};

describe("CATEGORIES", () => {
  it("lists categories in the required order", () => {
    expect(CATEGORIES).toEqual(["config", "beats", "characters", "rooms", "items"]);
  });

  it("has a display label for every category", () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });
});

describe("entriesForCategory", () => {
  it("returns an empty list for the config category", () => {
    expect(entriesForCategory(adventure, "config")).toEqual([]);
  });

  it("lists rooms with kind, id, and name as the label", () => {
    expect(entriesForCategory(adventure, "rooms")).toEqual([
      { kind: "room", id: "cavern", label: "Cavern" },
    ]);
  });

  it("lists items with kind, id, and name as the label", () => {
    expect(entriesForCategory(adventure, "items")).toEqual([
      { kind: "item", id: "key", label: "Key" },
    ]);
  });

  it("lists characters with kind, id, and name as the label", () => {
    expect(entriesForCategory(adventure, "characters")).toEqual([
      { kind: "character", id: "hermit", label: "Hermit" },
    ]);
  });

  it("lists beats with kind, id, and the beat's own id as the label (beats have no name)", () => {
    expect(entriesForCategory(adventure, "beats")).toEqual([
      { kind: "beat", id: "won-the-key", label: "won-the-key" },
    ]);
  });

  it("returns an empty list for a category with no entities defined", () => {
    const empty: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    expect(entriesForCategory(empty, "rooms")).toEqual([]);
    expect(entriesForCategory(empty, "beats")).toEqual([]);
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/tui/dev/entityCatalog.test.ts`
Expected: FAIL — `./entityCatalog.js` doesn't exist yet.

**Step 3: Write the implementation**

Create `src/tui/dev/entityCatalog.ts`:

```ts
import type { Adventure } from "../../world/schema.js";
import type { EntityKind } from "../../world/entityWriter.js";

export type Category = "config" | "beats" | "characters" | "rooms" | "items";

/** Fixed sidebar order, per the design doc. */
export const CATEGORIES: readonly Category[] = [
  "config",
  "beats",
  "characters",
  "rooms",
  "items",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  config: "Adventure Config",
  beats: "Beats",
  characters: "Characters",
  rooms: "Rooms",
  items: "Items",
};

export interface CatalogEntry {
  kind: EntityKind;
  id: string;
  /** the entity's `name` for room/item/character; its `id` for beat, which has no name field. */
  label: string;
}

/**
 * List a category's entities in the adventure's own definition order
 * (inline `adventure.yaml` entries first, then conventional-directory
 * files — whatever order `loadAdventure` already produced). Returns `[]`
 * for the `config` category, which has no entity list of its own.
 */
export function entriesForCategory(
  adventure: Adventure,
  category: Category,
): CatalogEntry[] {
  switch (category) {
    case "config":
      return [];
    case "beats":
      return (adventure.beats ?? []).map((b) => ({
        kind: "beat" as const,
        id: b.id,
        label: b.id,
      }));
    case "characters":
      return (adventure.entities?.characters ?? []).map((c) => ({
        kind: "character" as const,
        id: c.id,
        label: c.name,
      }));
    case "rooms":
      return (adventure.entities?.rooms ?? []).map((r) => ({
        kind: "room" as const,
        id: r.id,
        label: r.name,
      }));
    case "items":
      return (adventure.entities?.items ?? []).map((i) => ({
        kind: "item" as const,
        id: i.id,
        label: i.name,
      }));
  }
}
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/tui/dev/entityCatalog.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/tui/dev/entityCatalog.ts src/tui/dev/entityCatalog.test.ts
git commit -m "Add entityCatalog: sidebar category/entity data model for xyzzy dev"
```

---

### Task 2: `renderFields.ts` — content pane field renderer

**Files:**
- Create: `src/tui/dev/renderFields.ts`
- Test: `src/tui/dev/renderFields.test.ts`

**Step 1: Write the failing tests**

Create `src/tui/dev/renderFields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  renderRoomFields,
  renderItemFields,
  renderCharacterFields,
  renderBeatFields,
  renderConfigFields,
  renderFieldsFor,
} from "./renderFields.js";
import type { Adventure, Character, Item, Room, StoryBeat } from "../../world/schema.js";

describe("renderRoomFields", () => {
  it("renders name, description, and exits", () => {
    const room: Room = {
      id: "cavern",
      name: "Cavern",
      description: "A dark cavern.",
      exits: { north: "hall" },
    };
    expect(renderRoomFields(room)).toEqual([
      { label: "Name", value: "Cavern", dim: false },
      { label: "Description", value: "A dark cavern.", dim: false },
      { label: "Exits", value: "north -> hall", dim: false },
    ]);
  });

  it("renders a dim placeholder for exits when there are none", () => {
    const room: Room = { id: "cavern", name: "Cavern", description: "d" };
    const rows = renderRoomFields(room);
    expect(rows.find((r) => r.label === "Exits")).toEqual({
      label: "Exits",
      value: "(none)",
      dim: true,
    });
  });
});

describe("renderItemFields", () => {
  it("renders location when set", () => {
    const item: Item = { id: "key", name: "Key", description: "d", location: "cavern" };
    expect(renderItemFields(item)).toEqual([
      { label: "Name", value: "Key", dim: false },
      { label: "Description", value: "d", dim: false },
      { label: "Location", value: "cavern", dim: false },
    ]);
  });

  it("renders a dim placeholder for an unset location", () => {
    const item: Item = { id: "key", name: "Key", description: "d" };
    const rows = renderItemFields(item);
    const location = rows.find((r) => r.label === "Location")!;
    expect(location.dim).toBe(true);
    expect(location.value).toContain("room or character id");
  });
});

describe("renderCharacterFields", () => {
  const base: Character = {
    id: "hermit",
    name: "Hermit",
    persona: "reclusive",
    history: [],
    state: {},
  };

  it("renders persona, location, and dim placeholders for empty structural fields", () => {
    const rows = renderCharacterFields(base);
    expect(rows).toContainEqual({ label: "Name", value: "Hermit", dim: false });
    expect(rows).toContainEqual({ label: "Persona", value: "reclusive", dim: false });
    expect(rows.find((r) => r.label === "Location")?.dim).toBe(true);
    expect(rows.find((r) => r.label === "History")).toEqual({
      label: "History",
      value: "(none)",
      dim: true,
    });
    expect(rows.find((r) => r.label === "State")).toEqual({
      label: "State",
      value: "(none)",
      dim: true,
    });
    expect(rows.find((r) => r.label === "Beats")).toEqual({
      label: "Beats",
      value: "(none)",
      dim: true,
    });
  });

  it("renders non-empty history/state/beats/interactions", () => {
    const full: Character = {
      ...base,
      location: "cavern",
      history: ["met the player"],
      state: { mood: "annoyed" },
      beats: [{ id: "confess", description: "d" }],
      interactions: [{ id: "offer-drink", description: "d", limit: 3 }],
    };
    const rows = renderCharacterFields(full);
    expect(rows.find((r) => r.label === "Location")).toEqual({
      label: "Location",
      value: "cavern",
      dim: false,
    });
    expect(rows.find((r) => r.label === "History")?.value).toBe("met the player");
    expect(rows.find((r) => r.label === "State")?.value).toContain("mood");
    expect(rows.find((r) => r.label === "Beats")?.value).toBe("confess");
    expect(rows.find((r) => r.label === "Interactions")?.value).toBe("offer-drink");
  });
});

describe("renderBeatFields", () => {
  it("renders id (not name), description, trigger, and effects", () => {
    const beat: StoryBeat = { id: "won-the-key", description: "d", trigger: "t" };
    expect(renderBeatFields(beat)).toEqual([
      { label: "id", value: "won-the-key", dim: false },
      { label: "Description", value: "d", dim: false },
      { label: "Trigger", value: "t", dim: false },
      { label: "Effects", value: "(none)", dim: true },
    ]);
  });

  it("renders a dim placeholder for an unset trigger", () => {
    const beat: StoryBeat = { id: "b", description: "d" };
    const rows = renderBeatFields(beat);
    expect(rows.find((r) => r.label === "Trigger")?.dim).toBe(true);
  });
});

describe("renderConfigFields", () => {
  it("renders meta and premise fields", () => {
    const adventure: Adventure = {
      meta: { id: "a", title: "A Title", version: "1", author: "Britt" },
      premise: "A premise.",
      start: {},
    };
    const rows = renderConfigFields(adventure);
    expect(rows).toContainEqual({ label: "Title", value: "A Title", dim: false });
    expect(rows).toContainEqual({ label: "Id", value: "a", dim: false });
    expect(rows).toContainEqual({ label: "Version", value: "1", dim: false });
    expect(rows).toContainEqual({ label: "Author", value: "Britt", dim: false });
    expect(rows).toContainEqual({ label: "Premise", value: "A premise.", dim: false });
  });

  it("renders a dim placeholder for an unset author", () => {
    const adventure: Adventure = {
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
    };
    expect(renderConfigFields(adventure).find((r) => r.label === "Author")?.dim).toBe(
      true,
    );
  });
});

describe("renderFieldsFor", () => {
  it("dispatches to the right renderer per category", () => {
    const room: Room = { id: "cavern", name: "Cavern", description: "d" };
    expect(renderFieldsFor("rooms", room)).toEqual(renderRoomFields(room));
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/tui/dev/renderFields.test.ts`
Expected: FAIL — `./renderFields.js` doesn't exist yet.

**Step 3: Write the implementation**

Create `src/tui/dev/renderFields.ts`:

```ts
import type { Adventure, Character, Item, Room, StoryBeat } from "../../world/schema.js";
import { ENTITY_FIELDS } from "../../world/entityWriter.js";
import type { Category } from "./entityCatalog.js";

export interface FieldRow {
  label: string;
  value: string;
  /** true when this row is an unset/empty placeholder rather than real data. */
  dim: boolean;
}

function placeholderFor(kind: "item" | "character" | "beat", key: string): string {
  return ENTITY_FIELDS[kind].find((f) => f.key === key)!.placeholder;
}

function scalarRow(label: string, value: string | undefined, placeholder: string): FieldRow {
  return value !== undefined
    ? { label, value, dim: false }
    : { label, value: placeholder, dim: true };
}

function listRow(label: string, values: string[]): FieldRow {
  return values.length
    ? { label, value: values.join(", "), dim: false }
    : { label, value: "(none)", dim: true };
}

export function renderRoomFields(room: Room): FieldRow[] {
  const exits = Object.entries(room.exits ?? {});
  return [
    { label: "Name", value: room.name, dim: false },
    { label: "Description", value: room.description, dim: false },
    listRow(
      "Exits",
      exits.map(([dir, target]) => `${dir} -> ${target}`),
    ),
  ];
}

export function renderItemFields(item: Item): FieldRow[] {
  return [
    { label: "Name", value: item.name, dim: false },
    { label: "Description", value: item.description, dim: false },
    scalarRow("Location", item.location, placeholderFor("item", "location")),
  ];
}

export function renderCharacterFields(character: Character): FieldRow[] {
  return [
    { label: "Name", value: character.name, dim: false },
    { label: "Persona", value: character.persona, dim: false },
    scalarRow("Location", character.location, placeholderFor("character", "location")),
    listRow("History", character.history),
    Object.keys(character.state).length
      ? { label: "State", value: JSON.stringify(character.state), dim: false }
      : { label: "State", value: "(none)", dim: true },
    listRow("Beats", (character.beats ?? []).map((b) => b.id)),
    listRow("Interactions", (character.interactions ?? []).map((i) => i.id)),
  ];
}

export function renderBeatFields(beat: StoryBeat): FieldRow[] {
  return [
    { label: "id", value: beat.id, dim: false },
    { label: "Description", value: beat.description, dim: false },
    scalarRow("Trigger", beat.trigger, placeholderFor("beat", "trigger")),
    beat.effects?.length
      ? { label: "Effects", value: `${beat.effects.length} effect(s)`, dim: false }
      : { label: "Effects", value: "(none)", dim: true },
  ];
}

export function renderConfigFields(adventure: Adventure): FieldRow[] {
  return [
    { label: "Title", value: adventure.meta.title, dim: false },
    { label: "Id", value: adventure.meta.id, dim: false },
    { label: "Version", value: adventure.meta.version, dim: false },
    scalarRow("Author", adventure.meta.author, "<author name>"),
    { label: "Premise", value: adventure.premise, dim: false },
  ];
}

/** Dispatch to the right renderer for a non-config category's entity. */
export function renderFieldsFor(
  category: Exclude<Category, "config">,
  entity: Room | Item | Character | StoryBeat,
): FieldRow[] {
  switch (category) {
    case "rooms":
      return renderRoomFields(entity as Room);
    case "items":
      return renderItemFields(entity as Item);
    case "characters":
      return renderCharacterFields(entity as Character);
    case "beats":
      return renderBeatFields(entity as StoryBeat);
  }
}
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/tui/dev/renderFields.test.ts`
Expected: PASS (all tests)

**Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/tui/dev/renderFields.ts src/tui/dev/renderFields.test.ts
git commit -m "Add renderFields: content pane field rendering for xyzzy dev"
```

---

### Task 3: `App.tsx` embeddability — `onQuit` and `inputActive` props

**Files:**
- Modify: `src/tui/App.tsx`
- Test: `src/tui/App.test.tsx`

**Step 1: Write the failing tests**

Add to `src/tui/App.test.tsx`. First, extend the local `mount()` helper to accept the two new props (it currently takes six positional params ending in `adventureDir`; add a seventh):

```ts
function mount(
  model: NarratorModel = new FakeNarratorModel(),
  makeModel: (config: ProviderConfig) => NarratorModel = () => model,
  listModels: (config: ProviderConfig) => Promise<string[]> = async () => [],
  providers: Record<string, ProviderConfig> = {},
  makeDetector?: (config: ProviderConfig) => Detector,
  adventureDir: string = mkdtempSync(join(tmpdir(), "xyzzy-tui-")),
  extra: { onQuit?: () => void; inputActive?: boolean } = {},
) {
  return render(
    <App
      adventure={adventure}
      initialState={newGameState(adventure, "now")}
      provider={provider}
      makeModel={makeModel}
      makeDetector={makeDetector}
      listModels={listModels}
      providers={providers}
      adventureDir={adventureDir}
      saveSlot="autosave"
      onQuit={extra.onQuit}
      inputActive={extra.inputActive}
    />,
  );
}
```

Then add a new `describe` block near the bottom of the file, before the final closing of the top-level `describe("App", ...)` block (or as its own top-level block — either is fine):

```ts
describe("embeddability", () => {
  it("/quit calls the onQuit override instead of exiting the Ink root, when provided", async () => {
    let quitCalls = 0;
    const { stdin, unmount } = mount(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { onQuit: () => quitCalls++ },
    );

    await type(stdin, "/quit");

    expect(quitCalls).toBe(1);
    unmount();
  });

  it("/quit exits the Ink app when no onQuit override is provided (default behavior)", async () => {
    const { lastFrame, stdin, unmount } = mount();

    await type(stdin, "/quit");
    const frameAtQuit = lastFrame();

    // The app has exited; further input has no visible effect.
    await type(stdin, "/help");
    expect(lastFrame()).toBe(frameAtQuit);
    unmount();
  });

  it("does not react to input when inputActive is false", async () => {
    const { lastFrame, stdin, unmount } = mount(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { inputActive: false },
    );
    const before = lastFrame();

    await type(stdin, "/help");

    // No new output — the input line is inactive, so nothing was submitted.
    expect(lastFrame()).toBe(before);
    unmount();
  });

  it("reacts to input again once inputActive becomes true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-tui-"));
    const { lastFrame, stdin, rerender, unmount } = mount(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      dir,
      { inputActive: false },
    );

    rerender(
      <App
        adventure={adventure}
        initialState={newGameState(adventure, "now")}
        provider={provider}
        makeModel={() => new FakeNarratorModel()}
        listModels={async () => []}
        providers={{}}
        adventureDir={dir}
        saveSlot="autosave"
        inputActive={true}
      />,
    );

    await type(stdin, "/help");

    await expect.poll(() => lastFrame()).toContain("/quit");
    unmount();
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/tui/App.test.tsx`
Expected: FAIL — `onQuit`/`inputActive` aren't recognized props yet (TypeScript will also complain); the `/quit`-with-`onQuit` test fails because `quitCalls` stays 0, and the `inputActive={false}` tests fail because the input line is still active by default.

**Step 3: Write the implementation**

In `src/tui/App.tsx`, extend `AppProps` (after the existing `saveSlot: string;` line):

```ts
  /** autosave slot */
  saveSlot: string;
  /**
   * Called instead of exiting the Ink root when `/quit` runs. Lets an
   * embedding parent (e.g. `DevApp`'s play-focus mode) unmount just this
   * instance instead of tearing down the whole process. Omit for standalone
   * `xyzzy play`, where `/quit` should exit normally.
   */
  onQuit?: () => void;
  /**
   * Whether the input line accepts keystrokes. Defaults to `true`. An
   * embedding parent sets this to `false` while a different pane has focus,
   * so this instance keeps rendering (scrollback, status bar) without
   * stealing input meant for the sidebar.
   */
  inputActive?: boolean;
```

Update the function signature to destructure both, with `inputActive` defaulted:

```ts
export function App({
  adventure,
  initialState,
  provider: initialProvider,
  makeModel,
  makeDetector,
  listModels,
  providers,
  adventureDir,
  saveSlot,
  onQuit,
  inputActive = true,
}: AppProps) {
```

Update the `/quit` case in `handleMeta`:

```ts
      case "/quit":
        if (onQuit) onQuit();
        else exit();
        return true;
```

Finally, pass `inputActive` through to `PromptInput` at the bottom of the render (currently `<PromptInput history={history} onSubmit={submit} />`):

```tsx
          <PromptInput history={history} onSubmit={submit} isActive={inputActive} />
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/tui/App.test.tsx`
Expected: PASS (all tests, including the four new ones)

**Step 5: Typecheck, lint, and commit**

```bash
bun run typecheck
bun run lint
git add src/tui/App.tsx src/tui/App.test.tsx
git commit -m "Add onQuit and inputActive props to App for embedding in xyzzy dev"
```

---

### Task 4: `DevApp.tsx` skeleton — sidebar navigation + content pane

**Files:**
- Create: `src/tui/DevApp.tsx`
- Test: `src/tui/DevApp.test.tsx`

This task builds the browsing half of the tool: category selector, entity list, content pane rendering, Tab/Shift+Tab/↑/↓ navigation. No editing or play yet — those are Tasks 5 and 6, added to this same component.

**Step 1: Write the failing tests**

Create `src/tui/DevApp.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { DevApp } from "./DevApp.js";
import type { Adventure } from "../world/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "Cave of Echoes", version: "1", author: "Britt" },
  premise: "A dark cave.",
  start: { room: "cavern" },
  entities: {
    rooms: [
      { id: "cavern", name: "Cavern", description: "A dark cavern.", exits: { north: "hall" } },
      { id: "hall", name: "Hall", description: "A long hall." },
    ],
    items: [{ id: "key", name: "Key", description: "A key." }],
    characters: [{ id: "hermit", name: "Hermit", persona: "reclusive", history: [], state: {} }],
  },
  beats: [{ id: "won-the-key", description: "You got the key." }],
};

const tick = () => new Promise((r) => setTimeout(r, 15));

function mount(a: Adventure = adventure) {
  return render(<DevApp adventure={a} adventureDir="/tmp/does-not-matter" />);
}

describe("DevApp sidebar", () => {
  it("starts on the Adventure Config category, showing its fields", () => {
    const { lastFrame, unmount } = mount();
    expect(lastFrame()).toContain("Adventure Config");
    expect(lastFrame()).toContain("Cave of Echoes");
    unmount();
  });

  it("lists categories in order", () => {
    const { lastFrame, unmount } = mount();
    const frame = lastFrame()!;
    const order = ["Adventure Config", "Beats", "Characters", "Rooms", "Items"].map((c) =>
      frame.indexOf(c),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    unmount();
  });

  it("Tab switches to the next category and shows its entity list", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("won-the-key"); // Beats category
    unmount();
  });

  it("Tab wraps from the last category back to the first", async () => {
    const { lastFrame, stdin, unmount } = mount();
    for (let i = 0; i < 5; i++) {
      stdin.write("\t");
      await tick();
    }
    expect(lastFrame()).toContain("Cave of Echoes"); // back to Config
    unmount();
  });

  it("selecting an entity with Down shows its fields in the content pane", async () => {
    const { lastFrame, stdin, unmount } = mount();
    stdin.write("\t"); // -> Beats
    await tick();
    stdin.write("\t"); // -> Characters
    await tick();
    expect(lastFrame()).toContain("Hermit");
    expect(lastFrame()).toContain("reclusive");
    unmount();
  });

  it("navigates entities within a category with Up/Down and updates the content pane", async () => {
    const { lastFrame, stdin, unmount } = mount();
    // Rooms is the 4th category: Config(0) -> Beats -> Characters -> Rooms
    for (let i = 0; i < 3; i++) {
      stdin.write("\t");
      await tick();
    }
    expect(lastFrame()).toContain("A dark cavern."); // first room selected by default
    stdin.write("[B"); // Down arrow
    await tick();
    expect(lastFrame()).toContain("A long hall.");
    unmount();
  });

  it("an empty category (no entities) shows no field rows without crashing", () => {
    const empty: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    const { lastFrame, unmount } = mount(empty);
    expect(lastFrame()).toBeTruthy();
    unmount();
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/tui/DevApp.test.tsx`
Expected: FAIL — `./DevApp.js` doesn't exist yet.

**Step 3: Write the implementation**

Create `src/tui/DevApp.tsx`:

```tsx
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Adventure, Character, Item, Room, StoryBeat } from "../world/schema.js";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  entriesForCategory,
  type CatalogEntry,
  type Category,
} from "./dev/entityCatalog.js";
import { renderConfigFields, renderFieldsFor, type FieldRow } from "./dev/renderFields.js";

export interface DevAppProps {
  adventure: Adventure;
  adventureDir: string;
}

type SelectionByCategory = Record<Category, number>;

const INITIAL_SELECTION: SelectionByCategory = {
  config: 0,
  beats: 0,
  characters: 0,
  rooms: 0,
  items: 0,
};

function findEntity(
  adventure: Adventure,
  entry: CatalogEntry,
): Room | Item | Character | StoryBeat | undefined {
  switch (entry.kind) {
    case "room":
      return adventure.entities?.rooms?.find((r) => r.id === entry.id);
    case "item":
      return adventure.entities?.items?.find((i) => i.id === entry.id);
    case "character":
      return adventure.entities?.characters?.find((c) => c.id === entry.id);
    case "beat":
      return adventure.beats?.find((b) => b.id === entry.id);
  }
}

export function DevApp({ adventure, adventureDir: _adventureDir }: DevAppProps) {
  const [category, setCategory] = useState<Category>("config");
  const [selection, setSelection] = useState<SelectionByCategory>(INITIAL_SELECTION);

  const entries = entriesForCategory(adventure, category);
  const index = entries.length === 0 ? 0 : Math.min(selection[category], entries.length - 1);

  useInput((_input, key) => {
    if (key.tab) {
      const step = key.shift ? -1 : 1;
      const i = CATEGORIES.indexOf(category);
      setCategory(CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!);
      return;
    }
    if (key.downArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.min(entries.length - 1, index + 1) }));
      return;
    }
    if (key.upArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.max(0, index - 1) }));
      return;
    }
  });

  const fieldRows: FieldRow[] =
    category === "config"
      ? renderConfigFields(adventure)
      : (() => {
          const entry = entries[index];
          if (!entry) return [];
          const entity = findEntity(adventure, entry);
          return entity ? renderFieldsFor(category, entity) : [];
        })();

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={26} marginRight={2}>
        {CATEGORIES.map((c) => (
          <Text key={c} inverse={c === category}>
            {CATEGORY_LABELS[c]}
          </Text>
        ))}
        <Text> </Text>
        {entries.map((e, i) => (
          <Text key={`${e.kind}:${e.id}`} inverse={i === index}>
            {"  " + e.label}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {fieldRows.map((row) => (
          <Text key={row.label} dimColor={row.dim}>
            {row.label}: {row.value}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

`adventureDir` is unused so far (renamed `_adventureDir` to satisfy the lint rule's `argsIgnorePattern: "^_"`); Tasks 5 and 6 both need it and will un-prefix it then.

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/tui/DevApp.test.tsx`
Expected: PASS (all 7 tests)

**Step 5: Typecheck, lint, and commit**

```bash
bun run typecheck
bun run lint
git add src/tui/DevApp.tsx src/tui/DevApp.test.tsx
git commit -m "Add DevApp skeleton: category sidebar + content pane navigation"
```

---

### Task 5: `DevApp.tsx` — editing flow (`e`, reload, validation banner + glyph)

**Files:**
- Modify: `src/tui/DevApp.tsx`
- Test: `src/tui/DevApp.test.tsx`

**Step 1: Write the failing tests**

Add to `src/tui/DevApp.test.tsx`. This task needs real files on disk (editing reloads via `readAdventureFile`), so add these imports at the top of the file:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Add a fixture builder and a new `describe` block:

```ts
const ADVENTURE_YAML = `
meta:
  id: a
  title: Cave of Echoes
  version: "1"
premise: A dark cave.
start:
  room: cavern
`;

const CAVERN_YAML = `
id: cavern
name: Cavern
description: A dark cavern.
exits:
  north: hall
`;

const HALL_YAML = `
id: hall
name: Hall
description: A long hall.
`;

function tmpAdventure(): string {
  const dir = mkdtempSync(join(tmpdir(), "xyzzy-devapp-"));
  writeFileSync(join(dir, "adventure.yaml"), ADVENTURE_YAML, "utf8");
  mkdirSync(join(dir, "rooms"));
  writeFileSync(join(dir, "rooms", "cavern.yaml"), CAVERN_YAML, "utf8");
  writeFileSync(join(dir, "rooms", "hall.yaml"), HALL_YAML, "utf8");
  return dir;
}

describe("DevApp editing", () => {
  it("pressing e opens the selected entity's file via the injected openEditor", async () => {
    const dir = tmpAdventure();
    const opened: string[] = [];
    const { stdin, unmount } = render(
      <DevApp
        adventure={adventure}
        adventureDir={dir}
        openEditor={(path) => opened.push(path)}
      />,
    );
    for (let i = 0; i < 3; i++) {
      stdin.write("\t"); // Config -> Beats -> Characters -> Rooms
      await tick();
    }
    stdin.write("e");
    await tick();
    expect(opened).toEqual([join(dir, "rooms", "cavern.yaml")]);
    unmount();
  });

  it("pressing e on the config category opens adventure.yaml itself", async () => {
    const dir = tmpAdventure();
    const opened: string[] = [];
    const { stdin, unmount } = render(
      <DevApp
        adventure={adventure}
        adventureDir={dir}
        openEditor={(path) => opened.push(path)}
      />,
    );
    stdin.write("e");
    await tick();
    expect(opened).toEqual([join(dir, "adventure.yaml")]);
    unmount();
  });

  it("a successful edit reloads and reflects the new content", async () => {
    const dir = tmpAdventure();
    const openEditor = (path: string) => {
      writeFileSync(path, CAVERN_YAML.replace("A dark cavern.", "A newly lit cavern."), "utf8");
    };
    const { lastFrame, stdin, unmount } = render(
      <DevApp adventure={adventure} adventureDir={dir} openEditor={openEditor} />,
    );
    for (let i = 0; i < 3; i++) {
      stdin.write("\t");
      await tick();
    }
    stdin.write("e");
    await tick();
    expect(lastFrame()).toContain("A newly lit cavern.");
    unmount();
  });

  it("an edit that breaks validation shows an inline banner and a tree glyph, without disturbing other entities", async () => {
    const dir = tmpAdventure();
    const openEditor = (path: string) => {
      // Point the exit at a room that doesn't exist.
      writeFileSync(path, CAVERN_YAML.replace("north: hall", "north: nowhere"), "utf8");
    };
    const { lastFrame, stdin, unmount } = render(
      <DevApp adventure={adventure} adventureDir={dir} openEditor={openEditor} />,
    );
    for (let i = 0; i < 3; i++) {
      stdin.write("\t");
      await tick();
    }
    stdin.write("e");
    await tick();
    expect(lastFrame()).toContain("nowhere");
    expect(lastFrame()).toContain("⚠");

    // The other room is untouched and still browsable.
    stdin.write("[B"); // Down to Hall
    await tick();
    expect(lastFrame()).toContain("A long hall.");
    unmount();
  });

  it("re-editing the broken entity back to valid clears the glyph and banner", async () => {
    const dir = tmpAdventure();
    let content = CAVERN_YAML.replace("north: hall", "north: nowhere");
    const openEditor = (path: string) => writeFileSync(path, content, "utf8");
    const { lastFrame, stdin, unmount } = render(
      <DevApp adventure={adventure} adventureDir={dir} openEditor={openEditor} />,
    );
    for (let i = 0; i < 3; i++) {
      stdin.write("\t");
      await tick();
    }
    stdin.write("e");
    await tick();
    expect(lastFrame()).toContain("⚠");

    content = CAVERN_YAML; // fix it
    stdin.write("e");
    await tick();
    expect(lastFrame()).not.toContain("⚠");
    unmount();
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/tui/DevApp.test.tsx`
Expected: FAIL — `DevApp` doesn't accept an `openEditor` prop yet, `e` does nothing, no `⚠` glyph exists.

**Step 3: Write the implementation**

In `src/tui/DevApp.tsx`, add imports:

```ts
import { readAdventureFile, resolveAdventureFile } from "../world/loader.js";
import { validateAdventure, formatIssues, type ValidationIssue } from "../world/validator.js";
import { Adventure as AdventureSchema } from "../world/schema.js";
import { entityFilePath, type EntityKind } from "../world/entityWriter.js";
```

`Adventure` (the schema object, for `.parse`) is aliased to `AdventureSchema` because `Adventure` is already used as a type import from `../world/schema.js`. Update the type import line to also bring in the runtime export:

```ts
import {
  Adventure as AdventureSchema,
  type Adventure,
  type Character,
  type Item,
  type Room,
  type StoryBeat,
} from "../world/schema.js";
```

(Remove the old plain `import type { Adventure, ... }` line — this replaces it.)

Extend `DevAppProps`:

```ts
export interface DevAppProps {
  adventure: Adventure;
  adventureDir: string;
  /** injected for testability; defaults to a real $EDITOR spawn in dev.ts. */
  openEditor?: (path: string) => void;
}
```

Add an `entityKey` helper (module scope, above the component):

```ts
const CONFIG_KEY = "config";

function entityKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}
```

Update the component to track the live adventure and issues, un-prefix `adventureDir`, and handle `e`:

```tsx
export function DevApp({ adventure: initialAdventure, adventureDir, openEditor }: DevAppProps) {
  const [category, setCategory] = useState<Category>("config");
  const [selection, setSelection] = useState<SelectionByCategory>(INITIAL_SELECTION);
  const [adventure, setAdventure] = useState(initialAdventure);
  const [issues, setIssues] = useState<Record<string, ValidationIssue[]>>({});

  const entries = entriesForCategory(adventure, category);
  const index = entries.length === 0 ? 0 : Math.min(selection[category], entries.length - 1);
  const currentEntry = category === "config" ? undefined : entries[index];
  const currentKey =
    category === "config" ? CONFIG_KEY : currentEntry ? entityKey(currentEntry.kind, currentEntry.id) : undefined;

  function editSelected() {
    const path =
      category === "config"
        ? resolveAdventureFile(adventureDir)
        : currentEntry
          ? entityFilePath(adventureDir, currentEntry.kind, currentEntry.id)
          : undefined;
    if (!path || !currentKey) return;

    (openEditor ?? (() => {}))(path);

    const raw = readAdventureFile(adventureDir);
    const result = validateAdventure(raw);
    if (result.ok) {
      setAdventure(AdventureSchema.parse(raw));
      setIssues((prev) => {
        if (!(currentKey in prev)) return prev;
        const next = { ...prev };
        delete next[currentKey];
        return next;
      });
    } else {
      setIssues((prev) => ({ ...prev, [currentKey]: result.issues }));
    }
  }

  useInput((_input, key) => {
    if (key.tab) {
      const step = key.shift ? -1 : 1;
      const i = CATEGORIES.indexOf(category);
      setCategory(CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!);
      return;
    }
    if (key.downArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.min(entries.length - 1, index + 1) }));
      return;
    }
    if (key.upArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.max(0, index - 1) }));
      return;
    }
  }, {
    isActive: true,
  });

  // Separate useInput for `e` to keep the diff below focused — merge into
  // the hook above in practice; see note after this listing.
```

That split-hook aside is a mistake to avoid — **use one `useInput` call**. Fold the `e` handling into the existing hook instead of adding a second one:

```tsx
  useInput((input, key) => {
    if (key.tab) {
      const step = key.shift ? -1 : 1;
      const i = CATEGORIES.indexOf(category);
      setCategory(CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!);
      return;
    }
    if (key.downArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.min(entries.length - 1, index + 1) }));
      return;
    }
    if (key.upArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.max(0, index - 1) }));
      return;
    }
    if (input === "e") {
      editSelected();
      return;
    }
  });
```

Now update the content pane to show the banner when the current selection has issues, and the sidebar entity rows to show `⚠`:

```tsx
  const currentIssues = currentKey ? issues[currentKey] : undefined;

  const fieldRows: FieldRow[] =
    category === "config"
      ? renderConfigFields(adventure)
      : (() => {
          const entry = entries[index];
          if (!entry) return [];
          const entity = findEntity(adventure, entry);
          return entity ? renderFieldsFor(category, entity) : [];
        })();

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={26} marginRight={2}>
        {CATEGORIES.map((c) => (
          <Text key={c} inverse={c === category}>
            {CATEGORY_LABELS[c]}
          </Text>
        ))}
        <Text> </Text>
        {entries.map((e, i) => (
          <Text key={`${e.kind}:${e.id}`} inverse={i === index}>
            {"  " + e.label}
            {issues[entityKey(e.kind, e.id)] ? "  ⚠" : ""}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {currentIssues ? (
          <>
            <Text color="red">⚠ Validation failed:</Text>
            <Text color="red">{formatIssues(currentIssues)}</Text>
          </>
        ) : (
          fieldRows.map((row) => (
            <Text key={row.label} dimColor={row.dim}>
              {row.label}: {row.value}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
```

Note: after a successful reload the *old* `adventure` object is replaced, so `entries`/`findEntity` are recomputed from fresh data automatically on the next render — no separate "refresh" step needed.

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/tui/DevApp.test.tsx`
Expected: PASS (all tests from Tasks 4 and 5)

**Step 5: Typecheck, lint, and commit**

```bash
bun run typecheck
bun run lint
git add src/tui/DevApp.tsx src/tui/DevApp.test.tsx
git commit -m "Add editing flow to DevApp: e opens \$EDITOR, reload validates, glyph+banner on failure"
```

---

### Task 6: `DevApp.tsx` — play-focus mode

**Files:**
- Modify: `src/tui/DevApp.tsx`
- Test: `src/tui/DevApp.test.tsx`

**Step 1: Write the failing tests**

Add to `src/tui/DevApp.test.tsx`. Add these imports at the top:

```ts
import { FakeNarratorModel, type NarratorModel } from "../llm/NarratorModel.js";
import { saveGame } from "../engine/save.js";
import { newGameState } from "../engine/state.js";
import type { ProviderConfig } from "../config/schema.js";
```

Add a `provider` fixture and a play-mounting helper alongside the existing ones:

```ts
const provider: ProviderConfig = {
  kind: "openai-compatible",
  baseURL: "http://localhost:11434/v1",
  model: "llama3.1",
};

function mountForPlay(
  dir: string,
  model: NarratorModel = new FakeNarratorModel(),
) {
  return render(
    <DevApp
      adventure={adventure}
      adventureDir={dir}
      provider={provider}
      makeModel={() => model}
      listModels={async () => []}
      providers={{}}
    />,
  );
}
```

Add the new `describe` block:

```ts
describe("DevApp play-focus mode", () => {
  it("p opens the New Game / Resume submenu", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    stdin.write("p");
    await tick();
    expect(lastFrame()).toContain("New Game");
    unmount();
  });

  it("the submenu lists existing saves below New Game", async () => {
    const dir = tmpAdventure();
    await saveGame(dir, "before-boss", newGameState(adventure, "now"));
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    stdin.write("p");
    await tick();
    expect(lastFrame()).toContain("New Game");
    expect(lastFrame()).toContain("before-boss");
    unmount();
  });

  it("choosing New Game mounts the embedded play session, focused", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    stdin.write("p");
    await tick();
    stdin.write("\r"); // New Game is the first/default option
    await tick();
    expect(lastFrame()).toContain("A dark cave."); // App's seeded narration line
    unmount();
  });

  it("Escape returns focus to the sidebar while the session keeps running", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    stdin.write("p");
    await tick();
    stdin.write("\r");
    await tick();

    stdin.write(""); // Escape
    await tick();
    // Sidebar navigation (Tab) works again -> Beats category visible.
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("won-the-key");
    unmount();
  });

  it("pressing p again re-focuses the same live session instead of restarting it", async () => {
    const model = new FakeNarratorModel([
      { narration: "You strike the match.", actions: [] },
    ]);
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir, model);
    stdin.write("p");
    await tick();
    stdin.write("\r");
    await tick();

    // Take a turn so the session has state worth preserving.
    await tick();
    stdin.write("strike match");
    await tick();
    stdin.write("\r");
    await expect.poll(() => lastFrame()).toContain("You strike the match.");

    stdin.write(""); // Escape back to sidebar
    await tick();
    stdin.write("p"); // re-focus, not restart
    await tick();

    expect(lastFrame()).toContain("You strike the match."); // scrollback preserved
    unmount();
  });

  it("quitting the embedded session (/quit) returns to the previously selected entity", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    stdin.write("p");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("A dark cave.");

    await tick();
    stdin.write("/quit");
    await tick();
    stdin.write("\r");
    await tick();

    // Back to the sidebar/content pane (Adventure Config, the default selection).
    expect(lastFrame()).toContain("Cave of Echoes");
    unmount();
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/tui/DevApp.test.tsx`
Expected: FAIL — `DevApp` doesn't accept `provider`/`makeModel`/etc. yet, `p` does nothing.

**Step 3: Write the implementation**

In `src/tui/DevApp.tsx`, add imports:

```ts
import { App } from "./App.js";
import type { NarratorModel } from "../llm/NarratorModel.js";
import type { Detector } from "../llm/Detector.js";
import type { ProviderConfig } from "../config/schema.js";
import type { GameState } from "../world/schema.js"; // add GameState to the existing schema import
import { listSaves, loadGame } from "../engine/save.js";
```

Extend `DevAppProps` with the same play-session props `App.tsx` needs (mirroring `AppProps`, minus `adventure`/`initialState`/`adventureDir`, which `DevApp` already has or computes):

```ts
export interface DevAppProps {
  adventure: Adventure;
  adventureDir: string;
  openEditor?: (path: string) => void;
  /** provider + factories for the embedded play session; optional so the
   * Task 4/5 tests (which never press `p`) don't need to supply them. */
  provider?: ProviderConfig;
  makeModel?: (config: ProviderConfig) => NarratorModel;
  makeDetector?: (config: ProviderConfig) => Detector;
  listModels?: (config: ProviderConfig) => Promise<string[]>;
  providers?: Record<string, ProviderConfig>;
  saveSlot?: string;
}
```

Add play-session state and derive the submenu options:

```tsx
type Focus = "sidebar" | "play";

export function DevApp({
  adventure: initialAdventure,
  adventureDir,
  openEditor,
  provider,
  makeModel,
  makeDetector,
  listModels,
  providers = {},
  saveSlot = "autosave",
}: DevAppProps) {
  const [category, setCategory] = useState<Category>("config");
  const [selection, setSelection] = useState<SelectionByCategory>(INITIAL_SELECTION);
  const [adventure, setAdventure] = useState(initialAdventure);
  const [issues, setIssues] = useState<Record<string, ValidationIssue[]>>({});
  const [focus, setFocus] = useState<Focus>("sidebar");
  const [playState, setPlayState] = useState<GameState | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuIndex, setSubmenuIndex] = useState(0);

  const saves = listSaves(adventureDir);
  const submenuOptions = ["New Game", ...saves];

  async function startPlay(optionIndex: number) {
    const state =
      optionIndex === 0
        ? newGameStateFor(adventure)
        : await loadGame(adventureDir, saves[optionIndex - 1]!);
    setPlayState(state);
    setSubmenuOpen(false);
    setFocus("play");
  }
```

`newGameStateFor` wraps `newGameState` so the timestamp is computed once at call time (avoids importing `newGameState` under a name that shadows anything):

```ts
import { newGameState } from "../engine/state.js";
```

```ts
function newGameStateFor(adventure: Adventure): GameState {
  return newGameState(adventure, new Date().toISOString());
}
```
(module scope, near the other free functions).

Now fold play-focus keys into the single `useInput` hook — **Escape and `p` are checked first, unconditionally; sidebar keys are gated on `focus === "sidebar"`; submenu navigation is its own early branch**:

```tsx
  useInput((input, key) => {
    if (key.escape) {
      setFocus("sidebar");
      return;
    }
    if (submenuOpen) {
      if (key.downArrow) {
        setSubmenuIndex((i) => Math.min(submenuOptions.length - 1, i + 1));
        return;
      }
      if (key.upArrow) {
        setSubmenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.return) {
        void startPlay(submenuIndex);
        return;
      }
      return;
    }
    if (input === "p") {
      if (playState) setFocus("play");
      else {
        setSubmenuIndex(0);
        setSubmenuOpen(true);
      }
      return;
    }
    if (focus === "play") return; // everything else belongs to the embedded App

    if (key.tab) {
      const step = key.shift ? -1 : 1;
      const i = CATEGORIES.indexOf(category);
      setCategory(CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!);
      return;
    }
    if (key.downArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.min(entries.length - 1, index + 1) }));
      return;
    }
    if (key.upArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.max(0, index - 1) }));
      return;
    }
    if (input === "e") {
      editSelected();
      return;
    }
  });
```

Finally, update the render: the content pane shows the submenu, or the embedded `App`, or the normal field rows/banner, in that priority. The sidebar always renders:

```tsx
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={26} marginRight={2}>
        {CATEGORIES.map((c) => (
          <Text key={c} inverse={c === category}>
            {CATEGORY_LABELS[c]}
          </Text>
        ))}
        <Text> </Text>
        {entries.map((e, i) => (
          <Text key={`${e.kind}:${e.id}`} inverse={i === index}>
            {"  " + e.label}
            {issues[entityKey(e.kind, e.id)] ? "  ⚠" : ""}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {submenuOpen ? (
          <Box flexDirection="column">
            <Text>Play:</Text>
            {submenuOptions.map((opt, i) => (
              <Text key={opt} inverse={i === submenuIndex}>
                {opt}
              </Text>
            ))}
          </Box>
        ) : playState && provider && makeModel && listModels ? (
          <App
            adventure={adventure}
            initialState={playState}
            provider={provider}
            makeModel={makeModel}
            makeDetector={makeDetector}
            listModels={listModels}
            providers={providers}
            adventureDir={adventureDir}
            saveSlot={saveSlot}
            inputActive={focus === "play"}
            onQuit={() => {
              setPlayState(null);
              setFocus("sidebar");
            }}
          />
        ) : currentIssues ? (
          <>
            <Text color="red">⚠ Validation failed:</Text>
            <Text color="red">{formatIssues(currentIssues)}</Text>
          </>
        ) : (
          fieldRows.map((row) => (
            <Text key={row.label} dimColor={row.dim}>
              {row.label}: {row.value}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
```

**Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/tui/DevApp.test.tsx`
Expected: PASS (all tests from Tasks 4, 5, and 6)

**Step 5: Typecheck, lint, and commit**

```bash
bun run typecheck
bun run lint
git add src/tui/DevApp.tsx src/tui/DevApp.test.tsx
git commit -m "Add play-focus mode to DevApp: submenu, embedded App, focus switching"
```

**Step 6: Coverage check**

Run: `bunx vitest run --coverage src/tui/DevApp.test.tsx src/tui/dev/entityCatalog.test.ts src/tui/dev/renderFields.test.ts`

If `DevApp.tsx` falls short of 90%/90%/85%/90% (lines/functions/branches/statements), add test cases for the missing branches rather than relaxing scope — likely candidates: pressing `e` with no entity selected in an empty category, the submenu's Up/Down bounds, and `q` (added in Task 7's CLI wiring — safe to defer that one branch's coverage check to Task 9's final pass if `q` isn't wired into `DevApp` itself yet). Note `DevApp` as written above does *not* handle `q` — that's intentional; quitting the whole tool is `dev.ts`'s job via `useApp().exit()`, added in Task 7.

---

### Task 7: `src/cli/commands/dev.ts` — command orchestration

**Files:**
- Create: `src/cli/commands/dev.ts`

No dedicated test file — this mirrors `play.ts`, which is thin TTY/Ink orchestration glue with no test file of its own (verified manually, per `VERIFICATION_PLAN.md`'s existing convention). `DevApp`'s actual logic is already covered by `DevApp.test.tsx`.

**Step 1: Write the implementation**

Create `src/cli/commands/dev.ts`:

```ts
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { render, useApp } from "ink";
import { DevApp } from "../../tui/DevApp.js";
import { loadAdventure, resolveAdventureFile } from "../../world/loader.js";
import { resolveProvider } from "../../config/resolve.js";
import { readGlobalConfig } from "../../config/store.js";
import { createDetector, createModel, listModels } from "../../llm/registry.js";
import { log } from "../../util/log.js";

export interface DevOptions {
  provider?: string;
}

/** Suspend the Ink render, run $EDITOR (or $VISUAL, or vi) on `path` with the
 * real TTY, and resume once it exits. */
function defaultOpenEditor(path: string): void {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  spawnSync(editor, [path], { stdio: "inherit" });
}

export async function dev(path: string, opts: DevOptions): Promise<void> {
  const adventure = await loadAdventure(path);
  const adventureDir = dirname(resolveAdventureFile(path));

  const provider = await resolveProvider({
    providerFlag: opts.provider,
    adventureDir,
  });
  const providers = (await readGlobalConfig()).providers;

  log.info("dev started", { adventure: adventure.meta.id });

  const { waitUntilExit } = render(
    createElement(DevApp, {
      adventure,
      adventureDir,
      openEditor: defaultOpenEditor,
      provider,
      makeModel: createModel,
      makeDetector: createDetector,
      listModels,
      providers,
    }),
  );
  await waitUntilExit();
  process.exit(0);
}
```

Note: `useApp` is imported but unused in this listing — `DevApp` itself doesn't yet call `exit()` for the whole-tool-quit (`q`) key. Add that now as a small follow-up inside `DevApp.tsx` rather than here, since `useApp()` must be called from inside the Ink tree, not from `dev.ts`:

**Step 2: Wire `q` (quit the whole tool) into `DevApp.tsx`**

In `src/tui/DevApp.tsx`, add the import:

```ts
import { Box, Text, useApp, useInput } from "ink"; // add useApp to the existing ink import
```

Inside the component, call the hook:

```ts
  const { exit } = useApp();
```

And add a branch to the `useInput` handler, right after the `if (focus === "play") return;` guard (so `q` while playing is just a normal character typed into the play session, not a global quit):

```ts
    if (input === "q") {
      exit();
      return;
    }
```

**Step 3: Add the test for `q`**

Add to `src/tui/DevApp.test.tsx`:

```ts
it("q quits the whole tool when the sidebar has focus", async () => {
  const dir = tmpAdventure();
  const { lastFrame, stdin, unmount } = mountForPlay(dir);
  stdin.write("q");
  await tick();
  const frameAtQuit = lastFrame();
  stdin.write("\t"); // no longer has any effect — the app exited
  await tick();
  expect(lastFrame()).toBe(frameAtQuit);
  unmount();
});

it("q while play has focus is typed into the play session, not treated as quit", async () => {
  const dir = tmpAdventure();
  const { lastFrame, stdin, unmount } = mountForPlay(dir);
  stdin.write("p");
  await tick();
  stdin.write("\r");
  await tick();
  stdin.write("q"); // types "q" into the play input line
  await tick();
  // The tool is still running — Escape still works.
  stdin.write("");
  await tick();
  stdin.write("\t");
  await tick();
  expect(lastFrame()).toContain("won-the-key");
  unmount();
});
```

Run: `bunx vitest run src/tui/DevApp.test.tsx`
Expected: PASS (all tests)

**Step 4: Typecheck, lint, and commit**

```bash
bun run typecheck
bun run lint
git add src/cli/commands/dev.ts src/tui/DevApp.tsx src/tui/DevApp.test.tsx
git commit -m "Add xyzzy dev command orchestration and whole-tool quit (q)"
```

---

### Task 8: CLI wiring

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/tui/index.ts`

No dedicated test — `index.ts` is excluded from the coverage config (see `IMPLEMENTATION_PLAN.md`'s existing note on this same convention). Verify manually per the steps below.

**Step 1: Export `DevApp`**

In `src/tui/index.ts`:

```ts
export * from "./App.js";
export * from "./DevApp.js";
```

**Step 2: Register the `dev` command**

In `src/cli/index.ts`, add the import alongside the others:

```ts
import { dev } from "./commands/dev.js";
```

Add the command registration after the existing `play` command block (which ends around the `.action((path, opts) => play(path, opts));` line):

```ts
  program
    .command("dev")
    .argument("<path>", "adventure directory")
    .option("--provider <name>", "provider to use for play-testing")
    .description("launch the multi-pane development TUI")
    .action((path: string, opts: { provider?: string }) => dev(path, opts));
```

**Step 3: Verify manually**

```bash
bun run start -- dev --help
```
Expected: shows the `dev` command's description and `--provider` option.

```bash
bun run start -- dev examples/cave-of-echoes
```
Expected (in a real terminal): the TUI launches, showing the Adventure Config category selected by default with Cave of Echoes' title. Press `q` to quit back to the shell. (Full interactive verification is Task 9's `VERIFICATION_PLAN.md` scenario — this is just a startup smoke check.)

**Step 4: Commit**

```bash
git add src/cli/index.ts src/tui/index.ts
git commit -m "Wire xyzzy dev into the CLI"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`
- Modify: `VERIFICATION_PLAN.md`

**Step 1: README**

Add a new section (near the existing `xyzzy play` / `xyzzy new` sections — match whatever heading level they use) covering:
- `xyzzy dev <path> [--provider <name>]` usage.
- The pane layout: category sidebar (Adventure Config, Beats, Characters, Rooms, Items — `Tab`/`Shift+Tab` to switch, `↑`/`↓` to navigate entities) + content pane (rendered fields, not raw YAML).
- `e` opens the selected file in `$EDITOR`; on save, the whole adventure reloads and re-validates — a validation failure shows an inline banner and a `⚠` next to that entity in the sidebar, without affecting anything else.
- `p` opens a New Game / Resume submenu, then embeds the same play session `xyzzy play` uses directly in the content pane; `Escape` returns focus to the sidebar without ending the session; `p` again re-focuses it.
- `q` quits the tool (from the sidebar; typed into an active play session it's just the letter "q").

**Step 2: VERIFICATION_PLAN.md — new Scenario 9**

Add after the existing Scenario 8, following the file's established format exactly (Context / Steps / Success Criteria / If Blocked):

```markdown
### Scenario 9: Multi-pane development TUI (`xyzzy dev`)

**Context**: `xyzzy dev` requires a real TTY, same as `play`'s Scenario 5. This scenario exercises browsing, editing via `$EDITOR`, validation-failure recovery, and embedded play-testing in one continuous session.

**Steps**:
1. Copy `examples/cave-of-echoes` to `/tmp/xyzzy-verify-dev`.
2. In a real terminal: `bun run start -- dev /tmp/xyzzy-verify-dev`
3. Confirm the Adventure Config category is selected by default and its fields (title, id, version, premise) are shown.
4. Press `Tab` three times to reach the Rooms category; confirm the room list appears and the first room's fields (name, description, exits) show in the content pane.
5. Press `e`; in `$EDITOR`, change the selected room's description, save, and quit the editor.
6. Confirm the content pane now shows the updated description.
7. Press `e` again; in `$EDITOR`, change an exit to point at a room id that doesn't exist (e.g. `nowhere`), save, and quit.
8. Confirm an inline validation-error banner appears in the content pane and a `⚠` appears next to that room in the sidebar; press `Tab`/`↑`/`↓` to confirm every other entity is still browsable normally.
9. Press `e` one more time and fix the exit back to a real room id; confirm the banner and `⚠` both clear.
10. Press `p`; confirm a submenu with "New Game" appears (plus any save slots).
11. Press Enter to start a new game; confirm the familiar `play` narration/status bar appears in the content pane, with the sidebar still visible alongside it.
12. Type a command and press Enter; confirm a turn runs (or, with no local LLM reachable, that the same "no language model is available" message `play` shows appears here too — not a crash).
13. Press `Escape`; confirm focus returns to the sidebar (`Tab` switches categories again) while the play pane remains visible with its scrollback intact.
14. Press `p` again; confirm the same session re-focuses (scrollback still there, not restarted).
15. Type `/quit` and press Enter inside the play pane; confirm the content pane returns to showing the sidebar's currently selected entity, and the tool itself is still running.
16. Press `q`; confirm the tool exits cleanly back to the shell.
17. Delete `/tmp/xyzzy-verify-dev`.

**Success Criteria**:
- [ ] Step 3 shows Adventure Config fields by default
- [ ] Step 4 shows the Rooms entity list and a room's rendered fields (not raw YAML)
- [ ] Steps 5-6 show the edited description without restarting the tool
- [ ] Step 8 shows both the inline banner and the sidebar `⚠`, and every other entity stays normally browsable
- [ ] Step 9 clears both the banner and the glyph
- [ ] Steps 10-12 launch and drive an embedded play session without leaving the tool
- [ ] Step 13 returns keyboard focus to the sidebar without ending the play session
- [ ] Step 14 re-focuses the same session (no restart, scrollback intact)
- [ ] Step 15 exits play-focus without exiting the whole tool
- [ ] Step 16 exits the whole tool cleanly

**If Blocked**: If no real TTY is available, stop and ask the developer to run this scenario, or note the limitation explicitly in the verification log — same as Scenarios 5 and 8. Do not substitute `ink-testing-library` and report it as this scenario passing; `DevApp.test.tsx` already covers that ground as a unit test, not verification.
```

**Step 3: Commit**

```bash
git add README.md VERIFICATION_PLAN.md
git commit -m "Document xyzzy dev in README and VERIFICATION_PLAN.md"
```

---

### Task 10: Final pass

**Step 1: Full test suite**

```bash
bun run test
```
Expected: all tests pass, zero failures.

**Step 2: Coverage**

```bash
bunx vitest run --coverage
```
Confirm the 90%/90%/85%/90% (lines/functions/branches/statements) thresholds are met for every new file: `src/tui/dev/entityCatalog.ts`, `src/tui/dev/renderFields.ts`, `src/tui/DevApp.tsx`, and the modified `src/tui/App.tsx`. If anything falls short, add the missing test cases rather than relaxing scope — do not delete or weaken assertions to hit the number.

**Step 3: Build**

```bash
bun run build
```
Expected: zero errors.

**Step 4: Lint**

```bash
bun run lint
```
Expected: zero errors/warnings.

**Step 5: Manual verification**

Run through `VERIFICATION_PLAN.md` Scenario 9 (added in Task 9) in a real terminal, per its own steps.

**Step 6: Update PROGRESS.md**

Per `CLAUDE.md`'s required format, append a `## Task 10: xyzzy dev — Final pass - COMPLETE` entry (and, if the developer wants per-task granularity matching `CLAUDE.md`'s letter, retroactively add entries for Tasks 1-9 too — each already has its own commit to timestamp against).

**Step 7: Final commit**

```bash
git add PROGRESS.md
git commit -m "xyzzy dev: final verification pass complete"
```
