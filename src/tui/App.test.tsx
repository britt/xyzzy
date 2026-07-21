import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { newGameState } from "../engine/state.js";
import { saveGame } from "../engine/save.js";
import { FakeNarratorModel, type NarratorModel } from "../llm/NarratorModel.js";
import { FakeDetector, type Detector } from "../llm/Detector.js";
import type { Adventure } from "../world/schema.js";
import type { ProviderConfig } from "../config/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "Cave", version: "1" },
  premise: "A dark cave.",
  start: { room: "start" },
  entities: {
    rooms: [
      { id: "start", name: "Start", description: "A cold stone chamber.", exits: { north: "hall" } },
      { id: "hall", name: "Hall", description: "A long hall." },
    ],
  },
};

const tick = () => new Promise((r) => setTimeout(r, 15));

/** Emulate a terminal: characters arrive, then Enter as its own event. The
 * leading tick lets a freshly (re)mounted input subscribe before we type — the
 * input remounts around each turn (spinner ↔ input). */
async function type(stdin: { write: (s: string) => void }, value: string) {
  await tick();
  stdin.write(value);
  await tick();
  stdin.write("\r");
  await tick();
}

const provider: ProviderConfig = {
  kind: "openai-compatible",
  baseURL: "http://localhost:11434/v1",
  model: "llama3.1",
};

function mount(
  model: NarratorModel = new FakeNarratorModel(),
  makeModel: (config: ProviderConfig) => NarratorModel = () => model,
  listModels: (config: ProviderConfig) => Promise<string[]> = async () => [],
  providers: Record<string, ProviderConfig> = {},
  makeDetector?: (config: ProviderConfig) => Detector,
  adventureDir: string = mkdtempSync(join(tmpdir(), "xyzzy-tui-")),
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
    />,
  );
}

describe("App", () => {
  it("seeds scrollback with the starting room and shows the status bar", () => {
    const { lastFrame, unmount } = mount(new FakeNarratorModel());
    expect(lastFrame()).toContain("A cold stone chamber.");
    expect(lastFrame()).toContain("Cave · Start · turn 0");
    unmount();
  });

  it("runs a turn and appends narration on submit", async () => {
    const model = new FakeNarratorModel([
      { narration: "You stride north.", actions: [{ type: "moveTo", room: "hall" }] },
    ]);
    const { lastFrame, stdin, unmount } = mount(model);

    await type(stdin, "go north");

    await expect.poll(() => lastFrame()).toContain("You stride north.");
    expect(lastFrame()).toContain("turn 1");
    unmount();
  });

  it("uses the injected detector to resolve movement for a turn", async () => {
    // The narration model emits no movement; detection owns the move north.
    const model = new FakeNarratorModel([
      { narration: "You walk on.", actions: [] },
    ]);
    const makeDetector = () =>
      new FakeDetector([
        { move: "north", advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
      ]);
    const { lastFrame, stdin, unmount } = mount(
      model,
      () => model,
      undefined,
      undefined,
      makeDetector,
    );

    await type(stdin, "go north");

    // The detected move landed us in the Hall; the status bar and the
    // authoritative exits footer reflect the new room.
    await expect.poll(() => lastFrame()).toContain("Cave · Hall · turn 1");
    unmount();
  });

  it("degrades silently when the detector cannot be built", async () => {
    // A detector that throws at build time must not crash the TUI; the turn
    // still narrates (movement just falls back to the narration model).
    const model = new FakeNarratorModel([
      { narration: "You stride north.", actions: [{ type: "moveTo", room: "hall" }] },
    ]);
    const makeDetector = () => {
      throw new Error("no detector for this provider");
    };
    const { lastFrame, stdin, unmount } = mount(
      model,
      () => model,
      undefined,
      undefined,
      makeDetector,
    );

    await type(stdin, "go north");

    await expect.poll(() => lastFrame()).toContain("You stride north.");
    expect(lastFrame()).toContain("turn 1"); // no crash, turn completed
    unmount();
  });

  it("intercepts meta commands before the model", async () => {
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel());

    await type(stdin, "/help");

    await expect.poll(() => lastFrame()).toContain("/quit");
    unmount();
  });

  it("/map draws the rooms, their connection, and the player's position", async () => {
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel());
    await type(stdin, "/map");
    await expect.poll(() => lastFrame()).toContain("Start @");
    expect(lastFrame()).toContain("Hall");
    unmount();
  });

  it("/state elides the transcript", async () => {
    const model = new FakeNarratorModel([
      { narration: "You look around.", actions: [] },
    ]);
    const { lastFrame, stdin, unmount } = mount(model);
    await type(stdin, "look"); // one turn → transcript has messages
    await expect.poll(() => lastFrame()).toContain("You look around.");

    await type(stdin, "/state");
    await expect.poll(() => lastFrame()).toContain('"transcript": "[ ... ]"');
    unmount();
  });

  it("/transcript prints the conversation, and reports when empty", async () => {
    const empty = mount(new FakeNarratorModel());
    await type(empty.stdin, "/transcript");
    await expect.poll(() => empty.lastFrame()).toContain("transcript is empty");
    empty.unmount();

    const model = new FakeNarratorModel([
      { narration: "A cold hush.", actions: [] },
    ]);
    const played = mount(model);
    await type(played.stdin, "listen");
    await expect.poll(() => played.lastFrame()).toContain("A cold hush.");
    await type(played.stdin, "/transcript");
    await expect
      .poll(() => played.lastFrame())
      .toContain("[1] narrator: A cold hush.");
    expect(played.lastFrame()).toContain("[1] player: listen");
    played.unmount();
  });

  it("/model with no argument shows the current LLM", async () => {
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel());

    await type(stdin, "/model");

    await expect.poll(() => lastFrame()).toContain('model "llama3.1"');
    expect(lastFrame()).toContain("http://localhost:11434/v1");
    unmount();
  });

  it("/model <id> rebuilds the model from the updated provider", async () => {
    const requested: ProviderConfig[] = [];
    const makeModel = (config: ProviderConfig) => {
      requested.push(config);
      return new FakeNarratorModel();
    };
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel(), makeModel);
    requested.length = 0; // ignore the lazy build on mount

    await type(stdin, "/model mistral");

    await expect.poll(() => lastFrame()).toContain('Model switched to "mistral"');
    expect(requested).toEqual([{ ...provider, model: "mistral" }]);
    unmount();
  });

  it("/model list shows the endpoint's models and marks the current one", async () => {
    const listModels = async () => ["llama3.1", "mistral", "phi3"];
    const { lastFrame, stdin, unmount } = mount(
      new FakeNarratorModel(),
      undefined,
      listModels,
    );

    await type(stdin, "/model list");

    await expect.poll(() => lastFrame()).toContain("Available models:");
    expect(lastFrame()).toContain("* llama3.1"); // current, marked
    expect(lastFrame()).toContain("mistral");
    unmount();
  });

  it("/model list responds gracefully when the endpoint is unreachable", async () => {
    const listModels = async () => {
      throw new Error("Cannot reach endpoint");
    };
    const { lastFrame, stdin, unmount } = mount(
      new FakeNarratorModel(),
      undefined,
      listModels,
    );

    await type(stdin, "/model list");

    // The command completes with an actionable info line, not an error banner.
    await expect.poll(() => lastFrame()).toContain("Couldn't list models");
    expect(lastFrame()).toContain("Cannot reach endpoint");
    expect(lastFrame()).toContain('Current model: "llama3.1"');
    expect(lastFrame()).not.toContain("! "); // no red error line
    unmount();
  });

  it("/provider shows the current provider", async () => {
    const { lastFrame, stdin, unmount } = mount();

    await type(stdin, "/provider");

    await expect.poll(() => lastFrame()).toContain("Provider: openai-compatible");
    expect(lastFrame()).toContain("http://localhost:11434/v1");
    unmount();
  });

  it("/provider list shows configured providers and the current one", async () => {
    const configured = {
      lmstudio: {
        kind: "openai-compatible" as const,
        baseURL: "http://localhost:1234/v1",
        model: "phi3",
      },
    };
    const { lastFrame, stdin, unmount } = mount(
      new FakeNarratorModel(),
      undefined,
      undefined,
      configured,
    );

    await type(stdin, "/provider list");

    await expect.poll(() => lastFrame()).toContain("Configured providers:");
    expect(lastFrame()).toContain("lmstudio");
    expect(lastFrame()).toContain("Current:");
    unmount();
  });

  it("/provider use <name> switches to a configured provider", async () => {
    const requested: ProviderConfig[] = [];
    const makeModel = (config: ProviderConfig) => {
      requested.push(config);
      return new FakeNarratorModel();
    };
    const lmstudio = {
      kind: "openai-compatible" as const,
      baseURL: "http://localhost:1234/v1",
      model: "phi3",
    };
    const { lastFrame, stdin, unmount } = mount(
      new FakeNarratorModel(),
      makeModel,
      undefined,
      { lmstudio },
    );
    requested.length = 0; // ignore the lazy build on mount

    await type(stdin, "/provider use lmstudio");

    await expect
      .poll(() => lastFrame())
      .toContain('Switched to provider "lmstudio"');
    expect(requested).toEqual([lmstudio]);
    unmount();
  });

  it("/provider use <unknown> reports the known providers", async () => {
    const { lastFrame, stdin, unmount } = mount();

    await type(stdin, "/provider use ghost");

    await expect.poll(() => lastFrame()).toContain('Unknown provider "ghost"');
    unmount();
  });

  it("/provider url <u> repoints the endpoint for the session", async () => {
    const requested: ProviderConfig[] = [];
    const makeModel = (config: ProviderConfig) => {
      requested.push(config);
      return new FakeNarratorModel();
    };
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel(), makeModel);
    requested.length = 0;

    await type(stdin, "/provider url http://box:8080/v1");

    await expect
      .poll(() => lastFrame())
      .toContain("Endpoint set to http://box:8080/v1");
    expect(requested[0]?.baseURL).toBe("http://box:8080/v1");
    unmount();
  });

  it("/load with no argument lists known saves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-tui-"));
    const state = newGameState(adventure, "now");
    await saveGame(dir, "autosave", state);
    await saveGame(dir, "before-boss", state);
    const { lastFrame, stdin, unmount } = mount(
      new FakeNarratorModel(),
      undefined,
      undefined,
      undefined,
      undefined,
      dir,
    );

    await type(stdin, "/load");

    await expect.poll(() => lastFrame()).toContain("Known saves:");
    expect(lastFrame()).toContain("autosave");
    expect(lastFrame()).toContain("before-boss");
    unmount();
  });

  it("/load list lists known saves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-tui-"));
    await saveGame(dir, "autosave", newGameState(adventure, "now"));
    const { lastFrame, stdin, unmount } = mount(
      new FakeNarratorModel(),
      undefined,
      undefined,
      undefined,
      undefined,
      dir,
    );

    await type(stdin, "/load list");

    await expect.poll(() => lastFrame()).toContain("Known saves:");
    expect(lastFrame()).toContain("autosave");
    unmount();
  });

  it("/load list reports when there are no saves", async () => {
    const { lastFrame, stdin, unmount } = mount();

    await type(stdin, "/load list");

    await expect.poll(() => lastFrame()).toContain("No saves found.");
    unmount();
  });

  it("/load <slot> still loads a specific save", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-tui-"));
    const state = newGameState(adventure, "now");
    await saveGame(dir, "before-boss", state);
    const { lastFrame, stdin, unmount } = mount(
      new FakeNarratorModel(),
      undefined,
      undefined,
      undefined,
      undefined,
      dir,
    );

    await type(stdin, "/load before-boss");

    await expect.poll(() => lastFrame()).toContain('Loaded slot "before-boss".');
    unmount();
  });

  // Input-line editing and Up/Down history are covered by
  // PromptInput.test.tsx (the live input line is not reliably readable via
  // lastFrame in ink-testing-library).

  it("starts and runs slash commands even when the model cannot be built", async () => {
    const makeModel = () => {
      throw new Error("no SDK for this provider");
    };
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel(), makeModel);

    // The TUI rendered despite the unbuildable model.
    expect(lastFrame()).toContain("A cold stone chamber.");

    // Slash commands still work.
    await type(stdin, "/help");
    await expect.poll(() => lastFrame()).toContain("/quit");

    // Taking a turn degrades gracefully instead of crashing.
    await type(stdin, "look around");
    await expect.poll(() => lastFrame()).toContain("no SDK for this provider");
    expect(lastFrame()).toContain("turn 0"); // no turn advanced
    unmount();
  });
});
