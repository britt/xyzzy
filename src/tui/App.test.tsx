import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { newGameState } from "../engine/state.js";
import { FakeNarratorModel } from "../llm/NarratorModel.js";
import type { Adventure } from "../world/schema.js";

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

function mount(model: FakeNarratorModel) {
  return render(
    <App
      adventure={adventure}
      initialState={newGameState(adventure, "now")}
      model={model}
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
});
