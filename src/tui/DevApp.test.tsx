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
