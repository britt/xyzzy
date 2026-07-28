import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { render as inkRender } from "ink";
import { DevApp } from "./DevApp.js";
import type { Adventure } from "../world/schema.js";
import { FakeNarratorModel, type NarratorModel } from "../llm/NarratorModel.js";
import { saveGame } from "../engine/save.js";
import { newGameState } from "../engine/state.js";
import type { ProviderConfig } from "../config/schema.js";

/** Real terminal escape sequences — Ink parses these into `key.upArrow` etc. */
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ESC = "\x1b";
const PGUP = "\x1b[5~";
const PGDN = "\x1b[6~";

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

const provider: ProviderConfig = {
  kind: "openai-compatible",
  baseURL: "http://localhost:11434/v1",
  model: "llama3.1",
};

function mountForPlay(dir: string, model: NarratorModel = new FakeNarratorModel()) {
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

  it("opens the file an entity is really defined in, even when its name differs from the id", async () => {
    // Mirrors examples/cave-of-echoes: one file holding two rooms, named
    // after neither of them. The `<kind>s/<id>.yaml` creation convention does
    // not describe where these live.
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-devapp-"));
    writeFileSync(join(dir, "adventure.yaml"), ADVENTURE_YAML, "utf8");
    mkdirSync(join(dir, "rooms"));
    writeFileSync(
      join(dir, "rooms", "cave.yaml"),
      `
- id: cavern
  name: Cavern
  description: A dark cavern.
  exits:
    north: hall
- id: hall
  name: Hall
  description: A long hall.
`,
      "utf8",
    );

    const opened: string[] = [];
    const { stdin, unmount } = render(
      <DevApp
        adventure={adventure}
        adventureDir={dir}
        openEditor={(p) => opened.push(p)}
      />,
    );
    await toRooms(stdin);
    await press(stdin, "e");
    expect(opened).toEqual([join(dir, "rooms", "cave.yaml")]);
    unmount();
  });

  it("opens adventure.yaml for an entity defined inline rather than in a kind directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-devapp-"));
    writeFileSync(
      join(dir, "adventure.yaml"),
      `${ADVENTURE_YAML}entities:
  rooms:
    - id: cavern
      name: Cavern
      description: A dark cavern.
`,
      "utf8",
    );

    const opened: string[] = [];
    const { stdin, unmount } = render(
      <DevApp
        adventure={adventure}
        adventureDir={dir}
        openEditor={(p) => opened.push(p)}
      />,
    );
    await toRooms(stdin);
    await press(stdin, "e");
    expect(opened).toEqual([join(dir, "adventure.yaml")]);
    unmount();
  });

  it("reports an editor that fails to launch instead of crashing the tool", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = render(
      <DevApp
        adventure={adventure}
        adventureDir={dir}
        openEditor={() => {
          throw new Error('Could not launch editor "nope-not-here"');
        }}
      />,
    );
    await toRooms(stdin);
    await press(stdin, "e");

    expect(lastFrame()).toContain("Could not launch editor");
    // Still alive: navigation keeps working.
    await press(stdin, DOWN);
    expect(lastFrame()).toContain("A long hall.");
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

describe("DevApp play-focus mode", () => {
  // Saves are keyed by adventure.meta.id under $XDG_STATE_HOME, shared by
  // every test in this suite — isolate each test's saves from the others'.
  const savedState = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-devapp-state-"));
  });
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  it("p opens the New Game / Resume submenu", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    expect(lastFrame()).toContain("New Game");
    unmount();
  });

  it("the submenu lists existing saves below New Game", async () => {
    const dir = tmpAdventure();
    await saveGame(adventure.meta.id, "before-boss", newGameState(adventure, "now"));
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    expect(lastFrame()).toContain("New Game");
    expect(lastFrame()).toContain("before-boss");
    unmount();
  });

  it("choosing New Game mounts the embedded play session, focused", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r"); // New Game is the first/default option
    // App seeds scrollback from the start room's description.
    expect(lastFrame()).toContain("A dark cavern.");
    unmount();
  });

  it("resuming a save loads that slot's state into the embedded session", async () => {
    const dir = tmpAdventure();
    const resumed = { ...newGameState(adventure, "now"), turn: 7, location: "hall" };
    await saveGame(adventure.meta.id, "before-boss", resumed);
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, DOWN); // New Game -> before-boss
    await press(stdin, "\r");
    await expect.poll(() => lastFrame()).toContain("turn 7");
    unmount();
  });

  it("submenu Up/Down move between options, clamp at the ends, and ignore other keys", async () => {
    const dir = tmpAdventure();
    await saveGame(adventure.meta.id, "before-boss", newGameState(adventure, "now"));
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");

    await press(stdin, UP); // already at the top — clamps, stays on New Game
    await press(stdin, DOWN); // -> before-boss
    await press(stdin, DOWN); // already at the bottom — clamps
    await press(stdin, UP); // back to New Game
    await press(stdin, "x"); // not a submenu key — ignored, menu stays open
    expect(lastFrame()).toContain("New Game");

    await press(stdin, "\r"); // starts a New Game, not the save
    expect(lastFrame()).toContain("A dark cavern.");
    expect(lastFrame()).toContain("turn 0");
    unmount();
  });

  it("Escape closes the submenu without starting a session", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    expect(lastFrame()).toContain("New Game");

    await press(stdin, ESC);
    // Back to browsing the Adventure Config pane; no play session mounted.
    expect(lastFrame()).not.toContain("New Game");
    expect(lastFrame()).toContain("A dark cave.");
    unmount();
  });

  it("Escape returns focus to the sidebar while the session keeps running", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");

    await press(stdin, ESC);
    // Sidebar navigation (Tab) works again -> Beats category visible.
    await press(stdin, "\t");
    expect(lastFrame()).toContain("won-the-key");
    unmount();
  });

  it("pressing p again re-focuses the same live session instead of restarting it", async () => {
    const model = new FakeNarratorModel([
      { narration: "You strike the match.", actions: [] },
    ]);
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir, model);
    await press(stdin, "p");
    await press(stdin, "\r");

    // Take a turn so the session has state worth preserving.
    await press(stdin, "strike match");
    await press(stdin, "\r");
    await expect.poll(() => lastFrame()).toContain("You strike the match.");

    await press(stdin, ESC); // back to sidebar
    await press(stdin, "p"); // re-focus, not restart

    expect(lastFrame()).toContain("You strike the match."); // scrollback preserved
    unmount();
  });

  it("still responds to input after the embedded session is quit with /quit", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");
    await press(stdin, "/quit");
    await press(stdin, "\r");

    // The sidebar owns the keyboard again.
    await press(stdin, "\t");
    expect(lastFrame()).toContain("won-the-key");
    unmount();
  });

  it("can still be quit with q after the embedded session is quit", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");
    await press(stdin, "/quit");
    await press(stdin, "\r");

    await press(stdin, "q");
    const frameAtQuit = lastFrame();
    await press(stdin, "\t"); // no effect — the app exited
    expect(lastFrame()).toBe(frameAtQuit);
    unmount();
  });

  it("q quits the whole tool when the sidebar has focus", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "q");
    const frameAtQuit = lastFrame();
    await press(stdin, "\t"); // no longer has any effect — the app exited
    expect(lastFrame()).toBe(frameAtQuit);
    unmount();
  });

  it("q while play has focus is typed into the play session, not treated as quit", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");
    await press(stdin, "q"); // types "q" into the play input line

    // The tool is still running — Escape and sidebar navigation still work.
    await press(stdin, ESC);
    await press(stdin, "\t");
    expect(lastFrame()).toContain("won-the-key");
    unmount();
  });

  it("quitting the embedded session (/quit) returns to the previously selected entity", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");
    expect(lastFrame()).toContain("A dark cavern.");

    await press(stdin, "/quit");
    await press(stdin, "\r");

    // Back to the sidebar/content pane (Adventure Config, the default selection).
    await expect.poll(() => lastFrame()).toContain("Cave of Echoes");
    unmount();
  });
});

/**
 * ink-testing-library's stdout hardcodes `columns: 100` and provides no
 * `rows`, so it cannot exercise full-height layout at all. These use Ink's
 * own renderer against a stdout that reports real dimensions.
 */
class SizedStdout extends EventEmitter {
  frames: string[] = [];
  columns: number;
  rows: number;
  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
  write = (frame: string) => {
    this.frames.push(frame);
  };
  lastFrame = () => this.frames.at(-1) ?? "";
}

class TtyStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  // Mirrors ink-testing-library's stdin: hand Ink the chunk via `readable`.
  write = (data: string) => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };
  read = () => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

function frameGeometry(stdout: SizedStdout) {
  const lines = stdout.lastFrame().replace(/\n$/, "").split("\n");
  const widths = lines.map((l) => l.replace(ANSI, "").length);
  return { height: lines.length, maxWidth: Math.max(...widths) };
}

function renderSized(
  columns: number,
  rows: number,
  props: Partial<React.ComponentProps<typeof DevApp>> = {},
) {
  const stdout = new SizedStdout(columns, rows);
  const stdin = new TtyStdin();
  const app = inkRender(
    <DevApp
      adventure={adventure}
      adventureDir="/tmp/does-not-matter"
      {...props}
    />,
    {
      stdout: stdout as never,
      stdin: stdin as never,
      patchConsole: false,
      // Ink writes no live frame when it detects CI (`isInCi` in ink/build/ink.js),
      // so without this the harness sees an empty stdout on GitHub Actions.
      // `debug` is checked ahead of that branch — and disables the 32ms render
      // throttle, making frames synchronous. ink-testing-library does the same.
      debug: true,
    },
  );
  return { stdout, stdin, app };
}

describe("DevApp fills the terminal", () => {
  it("occupies the full terminal height, less the row the trailing newline needs", () => {
    for (const [columns, rows] of [
      [80, 24],
      [120, 40],
      [200, 60],
    ] as const) {
      const { stdout, app } = renderSized(columns, rows);
      expect(frameGeometry(stdout).height).toBe(rows - 1);
      app.unmount();
    }
  });

  it("stays under stdout.rows, so Ink keeps diffing instead of clearing the terminal each frame", () => {
    const { stdout, app } = renderSized(80, 24);
    expect(frameGeometry(stdout).height).toBeLessThan(24);
    app.unmount();
  });

  it("never overflows the terminal width", () => {
    for (const [columns, rows] of [
      [80, 24],
      [120, 40],
      [40, 20],
    ] as const) {
      const { stdout, app } = renderSized(columns, rows);
      expect(frameGeometry(stdout).maxWidth).toBeLessThanOrEqual(columns);
      app.unmount();
    }
  });

  it("re-lays out when the terminal is resized", async () => {
    const { stdout, app } = renderSized(80, 24);
    expect(frameGeometry(stdout).height).toBe(23);

    // Let the effect that subscribes to `resize` flush before emitting, the
    // same mount-timing hazard `press()` guards against for key input.
    await tick();
    stdout.rows = 50;
    stdout.columns = 140;
    stdout.emit("resize");

    // Ink throttles renders at 32ms with a trailing edge, so poll rather than
    // assuming the redraw has already landed.
    await expect.poll(() => frameGeometry(stdout).height).toBe(49);
    app.unmount();
  });
});

describe("DevApp keeps an embedded play session inside the layout", () => {
  /** Narrates a distinct, greppable line per turn. */
  function countingModel(): NarratorModel {
    let n = 0;
    return {
      async generate() {
        n += 1;
        return { narration: `NARRATION-${n}`, actions: [] };
      },
    };
  }

  async function startSession(stdin: TtyStdin) {
    await press(stdin, "p");
    await press(stdin, "\r"); // New Game
  }

  it("does not grow past the terminal height as the transcript accumulates", async () => {
    const dir = tmpAdventure();
    const model = countingModel();
    const { stdout, stdin, app } = renderSized(100, 24, {
      adventureDir: dir,
      provider,
      makeModel: () => model,
      listModels: async () => [],
      providers: {},
    });

    await startSession(stdin);
    for (let i = 1; i <= 8; i++) {
      await press(stdin, `look${i}`);
      await press(stdin, "\r");
    }
    await expect.poll(() => stdout.lastFrame()).toContain("NARRATION-8");

    // The whole screen still fits: without bounding, <Static> plus a growing
    // transcript would push this past `rows` and trip Ink's clear-and-redraw.
    expect(frameGeometry(stdout).height).toBeLessThan(24);
    app.unmount();
  });

  it("keeps the sidebar visible alongside a long transcript", async () => {
    const dir = tmpAdventure();
    const model = countingModel();
    const { stdout, stdin, app } = renderSized(100, 24, {
      adventureDir: dir,
      provider,
      makeModel: () => model,
      listModels: async () => [],
      providers: {},
    });

    await startSession(stdin);
    for (let i = 1; i <= 8; i++) {
      await press(stdin, `look${i}`);
      await press(stdin, "\r");
    }
    await expect.poll(() => stdout.lastFrame()).toContain("NARRATION-8");

    const frame = stdout.lastFrame();
    expect(frame).toContain("Adventure Config");
    expect(frame).toContain("Rooms");
    app.unmount();
  });
});

describe("DevApp hot-key footer", () => {
  it("shows the sidebar's keys on the config category, without entity navigation", () => {
    const dir = tmpAdventure();
    const { lastFrame, unmount } = mountForPlay(dir);
    const frame = lastFrame()!;
    expect(frame).toContain("Tab");
    expect(frame).toContain("Edit");
    expect(frame).toContain("Play");
    expect(frame).toContain("Quit");
    expect(frame).not.toContain("Entity"); // config has no entity list
    unmount();
  });

  it("adds entity navigation once a category with several entries is selected", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await toRooms(stdin);
    expect(lastFrame()).toContain("Entity");
    unmount();
  });

  it("drops edit and navigation in an empty category", async () => {
    const empty: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    const { lastFrame, stdin, unmount } = render(
      <DevApp adventure={empty} adventureDir="/tmp/does-not-matter" />,
    );
    await press(stdin, "\t"); // -> Beats, which has no entries
    const frame = lastFrame()!;
    expect(frame).not.toContain("Entity");
    expect(frame).not.toContain("Edit");
    expect(frame).toContain("Quit");
    unmount();
  });

  it("shows only the submenu's keys while the play submenu is open", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    const frame = lastFrame()!;
    expect(frame).toContain("Choose");
    expect(frame).toContain("Start");
    expect(frame).toContain("Cancel");
    expect(frame).not.toContain("Quit");
    expect(frame).not.toContain("Category");
    unmount();
  });

  it("shows only Escape while the play session has focus", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");
    const frame = lastFrame()!;
    expect(frame).toContain("Sidebar");
    expect(frame).not.toContain("Quit");
    expect(frame).not.toContain("Category");
    unmount();
  });

  it("offers Resume rather than Play once a session is live but unfocused", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");
    await press(stdin, ESC);
    expect(lastFrame()).toContain("Resume");
    unmount();
  });

  it("hides play entirely when no provider is available to start a session", () => {
    const { lastFrame, unmount } = mount();
    const frame = lastFrame()!;
    expect(frame).toContain("Quit");
    expect(frame).not.toContain("Play");
    unmount();
  });
});

/** A character with enough fields to overflow a short pane. */
const crowded: Adventure = {
  ...adventure,
  entities: {
    ...adventure.entities,
    characters: [
      {
        id: "grimble",
        name: "Grimble",
        persona: "A suspicious hermit who hoards secrets and trusts nobody.",
        location: "cavern",
        history: ["Met the player", "Refused the offer", "Took the coin"],
        state: { trust: 10, mood: "wary" },
        beats: [{ id: "confess", description: "d" }],
        interactions: [{ id: "haggle", description: "d" }],
      },
    ],
  },
};

const frameText = (stdout: SizedStdout) =>
  stdout.lastFrame().replace(/\n$/, "").replace(ANSI, "");

/**
 * Tab to Characters (2 tabs from the default config category) and wait until
 * the pane has actually rendered. Ink throttles renders at 32ms, so reading a
 * frame straight after a keypress can still show the previous screen.
 */
async function toCharacters(stdin: TtyStdin, stdout: SizedStdout) {
  await press(stdin, "\t");
  await press(stdin, "\t");
  // The lowercase id is the heading subtitle, unique to the content pane.
  await expect.poll(() => frameText(stdout)).toContain("grimble");
}

describe("DevApp content pane scrolling", () => {
  it("never renders a pane taller than the terminal, however crowded the entity", async () => {
    const { stdout, stdin, app } = renderSized(74, 14, { adventure: crowded });
    await toCharacters(stdin, stdout);
    expect(frameGeometry(stdout).height).toBeLessThan(14);
    expect(frameGeometry(stdout).maxWidth).toBeLessThanOrEqual(74);
    app.unmount();
  });

  it("renders each label intact rather than interleaving it with its value", async () => {
    const { stdout, stdin, app } = renderSized(74, 14, { adventure: crowded });
    await toCharacters(stdin, stdout);
    const text = frameText(stdout);
    // The corruption this replaced produced fragments like "PeA suspicious".
    expect(text).toContain("Persona");
    expect(text).not.toMatch(/Pe[A-Z]/);
    expect(text).not.toMatch(/Hi\(none\)/);
    app.unmount();
  });

  it("PgDn reveals content below the fold, and PgUp returns to the top", async () => {
    const { stdout, stdin, app } = renderSized(74, 14, { adventure: crowded });
    await toCharacters(stdin, stdout);

    // The lowercase id is the heading's subtitle, unique to the content pane.
    await expect.poll(() => frameText(stdout)).toContain("grimble");
    expect(frameText(stdout)).not.toContain("haggle"); // last group, below the fold

    await press(stdin, PGDN);
    await expect.poll(() => frameText(stdout)).not.toContain("grimble");

    // Everything is reachable by paging, however the pane is sized.
    for (let i = 0; i < 5; i++) await press(stdin, PGDN);
    await expect.poll(() => frameText(stdout)).toContain("haggle");

    for (let i = 0; i < 8; i++) await press(stdin, PGUP);
    await expect.poll(() => frameText(stdout)).toContain("grimble");
    app.unmount();
  });

  it("does not scroll past the end", async () => {
    const { stdout, stdin, app } = renderSized(74, 14, { adventure: crowded });
    await toCharacters(stdin, stdout);
    for (let i = 0; i < 10; i++) await press(stdin, PGDN);
    // Clamped at the bottom, so the last group stays on screen.
    await expect.poll(() => frameText(stdout)).toContain("haggle");
    expect(frameGeometry(stdout).height).toBeLessThan(14);
    app.unmount();
  });

  it("returns to the top when a different entity is selected", async () => {
    const twoChars: Adventure = {
      ...crowded,
      entities: {
        ...crowded.entities,
        characters: [
          crowded.entities!.characters![0]!,
          { id: "other", name: "Other", persona: "p", history: [], state: {} },
        ],
      },
    };
    const { stdout, stdin, app } = renderSized(74, 14, { adventure: twoChars });
    await toCharacters(stdin, stdout);
    await press(stdin, PGDN); // scroll down
    // The lowercase id is the heading's subtitle, unique to the content pane
    // (the sidebar shows the capitalised name), so it proves we scrolled past it.
    await expect.poll(() => frameText(stdout)).not.toContain("grimble");

    await press(stdin, DOWN); // select the next character
    // Subtitle visible again: the pane scrolled back to the top.
    await expect.poll(() => frameText(stdout)).toContain("other");
    app.unmount();
  });

  it("offers the scroll keys only when the content actually overflows", async () => {
    const tall = renderSized(74, 40, { adventure: crowded });
    await toCharacters(tall.stdin, tall.stdout);
    expect(frameText(tall.stdout)).not.toContain("Scroll");
    tall.app.unmount();

    const short = renderSized(74, 14, { adventure: crowded });
    await toCharacters(short.stdin, short.stdout);
    expect(frameText(short.stdout)).toContain("Scroll");
    short.app.unmount();
  });
});

describe("DevApp footer divider", () => {
  it("draws a full-width rule immediately above the hot keys", () => {
    const { stdout, app } = renderSized(74, 14);
    const lines = frameText(stdout).split("\n");
    const footer = lines.findIndex((l) => l.includes("Quit"));

    expect(footer).toBeGreaterThan(0);
    expect(lines[footer - 1]).toMatch(/^─+$/);
    expect(lines[footer - 1]).toHaveLength(74);
    app.unmount();
  });

  it("keeps the whole screen within the terminal once the divider is added", () => {
    const { stdout, app } = renderSized(74, 14);
    expect(frameGeometry(stdout).height).toBe(13);
    expect(frameGeometry(stdout).maxWidth).toBeLessThanOrEqual(74);
    app.unmount();
  });

  it("still fits the divider when a crowded entity scrolls", async () => {
    const { stdout, stdin, app } = renderSized(74, 14, { adventure: crowded });
    await toCharacters(stdin, stdout);
    await press(stdin, PGDN);
    const lines = frameText(stdout).split("\n");
    const footer = lines.findIndex((l) => l.includes("Quit"));
    expect(lines[footer - 1]).toMatch(/^─+$/);
    expect(frameGeometry(stdout).height).toBe(13);
    app.unmount();
  });
});

describe("DevApp sidebar divider", () => {
  it("draws a vertical rule down the full height between the panes", () => {
    const { stdout, app } = renderSized(74, 14);
    const lines = frameText(stdout).split("\n");
    // Every pane row (all but the footer rule and key list) carries the rule
    // at the same column.
    const paneRows = lines.slice(0, -2);
    const columns = paneRows.map((l) => l.indexOf("│"));
    expect(columns.every((c) => c >= 0)).toBe(true);
    expect(new Set(columns).size).toBe(1);
    app.unmount();
  });

  it("keeps the rule to the left of the content pane's text", () => {
    const { stdout, app } = renderSized(74, 14);
    const line = frameText(stdout)
      .split("\n")
      .find((l) => l.includes("Cave of Echoes"))!;
    expect(line.indexOf("│")).toBeLessThan(line.indexOf("Cave of Echoes"));
    app.unmount();
  });

  it("still fits the terminal exactly with both rules present", () => {
    const { stdout, app } = renderSized(74, 14);
    expect(frameGeometry(stdout).height).toBe(13);
    expect(frameGeometry(stdout).maxWidth).toBeLessThanOrEqual(74);
    app.unmount();
  });
});
