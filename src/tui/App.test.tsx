import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { newGameState } from "../engine/state.js";
import { FakeNarratorModel, type NarratorModel } from "../llm/NarratorModel.js";
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

const tick = () => new Promise((r) => setTimeout(r, 10));

/** Emulate a terminal: characters arrive, then Enter as its own event. */
async function type(stdin: { write: (s: string) => void }, value: string) {
  stdin.write(value);
  await tick();
  stdin.write("\r");
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
) {
  return render(
    <App
      adventure={adventure}
      initialState={newGameState(adventure, "now")}
      provider={provider}
      makeModel={makeModel}
      listModels={listModels}
      providers={providers}
      adventureDir={mkdtempSync(join(tmpdir(), "xyzzy-tui-"))}
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

  it("intercepts meta commands before the model", async () => {
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel());

    await type(stdin, "/help");

    await expect.poll(() => lastFrame()).toContain("/quit");
    unmount();
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

  it("walks command history with up/down arrows (bash-style)", async () => {
    const UP = "\u001b[A";
    const DOWN = "\u001b[B";
    const { lastFrame, stdin, unmount } = mount();

    // Two commands whose recalled text doesn't appear in their output, so the
    // input line is the only place they can show up.
    await type(stdin, "/save alpha");
    await type(stdin, "/save beta");

    stdin.write(UP); // most recent
    await expect.poll(() => lastFrame()).toContain("/save beta");

    stdin.write(UP); // older
    await expect.poll(() => lastFrame()).toContain("/save alpha");
    expect(lastFrame()).not.toContain("> /save beta");

    stdin.write(DOWN); // newer again
    await expect.poll(() => lastFrame()).toContain("/save beta");

    stdin.write(DOWN); // past newest → empty draft restored
    await expect.poll(() => !lastFrame()?.includes("/save beta"));
    unmount();
  });

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
