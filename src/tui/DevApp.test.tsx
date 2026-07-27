import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { DevApp } from "./DevApp.js";
import type { Adventure } from "../world/schema.js";

/** Real terminal escape sequences — Ink parses these into `key.upArrow` etc. */
const UP = "\x1b[A";
const DOWN = "\x1b[B";

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

/**
 * Send one key. The leading tick lets a freshly mounted `useInput` subscribe
 * before we type — without it the very first keystroke of a test is dropped,
 * the same hazard `App.test.tsx`'s `type()` helper guards against.
 */
async function press(stdin: { write: (s: string) => void }, seq: string) {
  await tick();
  stdin.write(seq);
  await tick();
}

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
    await press(stdin, "\t");
    expect(lastFrame()).toContain("won-the-key"); // Beats category
    unmount();
  });

  it("Tab wraps from the last category back to the first", async () => {
    const { lastFrame, stdin, unmount } = mount();
    for (let i = 0; i < 5; i++) {
      await press(stdin, "\t");
    }
    expect(lastFrame()).toContain("Cave of Echoes"); // back to Config
    unmount();
  });

  it("Shift+Tab steps backwards, wrapping to the last category", async () => {
    const { lastFrame, stdin, unmount } = mount();
    await press(stdin, "\x1b[Z"); // Shift+Tab
    expect(lastFrame()).toContain("A key."); // Items, the last category
    unmount();
  });

  it("selecting an entity with Down shows its fields in the content pane", async () => {
    const { lastFrame, stdin, unmount } = mount();
    await press(stdin, "\t"); // -> Beats
    await press(stdin, "\t"); // -> Characters
    expect(lastFrame()).toContain("Hermit");
    expect(lastFrame()).toContain("reclusive");
    unmount();
  });

  it("navigates entities within a category with Up/Down and updates the content pane", async () => {
    const { lastFrame, stdin, unmount } = mount();
    // Rooms is the 4th category: Config(0) -> Beats -> Characters -> Rooms
    for (let i = 0; i < 3; i++) {
      await press(stdin, "\t");
    }
    expect(lastFrame()).toContain("A dark cavern."); // first room selected by default
    await press(stdin, DOWN);
    expect(lastFrame()).toContain("A long hall.");
    await press(stdin, UP);
    expect(lastFrame()).toContain("A dark cavern.");
    unmount();
  });

  it("clamps Up/Down at the ends of the entity list", async () => {
    const { lastFrame, stdin, unmount } = mount();
    for (let i = 0; i < 3; i++) {
      await press(stdin, "\t"); // -> Rooms
    }
    await press(stdin, UP); // already at the first entry
    expect(lastFrame()).toContain("A dark cavern.");
    await press(stdin, DOWN);
    await press(stdin, DOWN); // already at the last entry
    expect(lastFrame()).toContain("A long hall.");
    unmount();
  });

  it("remembers each category's selection when you tab away and back", async () => {
    const { lastFrame, stdin, unmount } = mount();
    for (let i = 0; i < 3; i++) {
      await press(stdin, "\t"); // -> Rooms
    }
    await press(stdin, DOWN); // select Hall
    expect(lastFrame()).toContain("A long hall.");
    await press(stdin, "\t"); // -> Items
    await press(stdin, "\x1b[Z"); // back to Rooms
    expect(lastFrame()).toContain("A long hall.");
    unmount();
  });

  it("an empty category (no entities) shows no field rows without crashing", async () => {
    const empty: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    const { lastFrame, stdin, unmount } = mount(empty);
    expect(lastFrame()).toBeTruthy();
    await press(stdin, "\t"); // -> Beats, which has no entries
    await press(stdin, DOWN); // no-op, must not crash
    expect(lastFrame()).toContain("Beats");
    unmount();
  });
});

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

/** Tab from the default Config category over to Rooms, selecting Cavern. */
async function toRooms(stdin: { write: (s: string) => void }) {
  for (let i = 0; i < 3; i++) await press(stdin, "\t");
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
    await toRooms(stdin);
    await press(stdin, "e");
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
    await press(stdin, "e");
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
    await toRooms(stdin);
    await press(stdin, "e");
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
    await toRooms(stdin);
    await press(stdin, "e");
    expect(lastFrame()).toContain("nowhere");
    expect(lastFrame()).toContain("⚠");

    // The other room is untouched and still browsable.
    await press(stdin, DOWN);
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
    await toRooms(stdin);
    await press(stdin, "e");
    expect(lastFrame()).toContain("⚠");

    content = CAVERN_YAML; // fix it
    await press(stdin, "e");
    expect(lastFrame()).not.toContain("⚠");
    unmount();
  });

  it("surfaces malformed YAML as a banner instead of crashing the tool", async () => {
    const dir = tmpAdventure();
    let content = "id: cavern\nname: [unclosed\n";
    const openEditor = (path: string) => writeFileSync(path, content, "utf8");
    const { lastFrame, stdin, unmount } = render(
      <DevApp adventure={adventure} adventureDir={dir} openEditor={openEditor} />,
    );
    await toRooms(stdin);
    await press(stdin, "e");

    // The tool is alive and reporting, not torn down by the parse error.
    expect(lastFrame()).toContain("⚠");
    expect(lastFrame()).toContain("Invalid YAML");

    // And it recovers once the file parses again.
    content = CAVERN_YAML;
    await press(stdin, "e");
    expect(lastFrame()).not.toContain("⚠");
    expect(lastFrame()).toContain("A dark cavern.");
    unmount();
  });

  it("leaves the file untouched when no entity is selected in an empty category", async () => {
    const dir = tmpAdventure();
    const opened: string[] = [];
    const empty: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    const { stdin, unmount } = render(
      <DevApp
        adventure={empty}
        adventureDir={dir}
        openEditor={(path) => opened.push(path)}
      />,
    );
    await press(stdin, "\t"); // -> Beats, which has no entries
    await press(stdin, "e");
    expect(opened).toEqual([]);
    expect(readFileSync(join(dir, "adventure.yaml"), "utf8")).toBe(ADVENTURE_YAML);
    unmount();
  });
});
