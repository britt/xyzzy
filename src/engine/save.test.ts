import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSaves, loadGame, SaveLoadError, saveExists, saveGame } from "./save.js";
import { newGameState } from "./state.js";
import { savePath } from "./save.js";
import type { Adventure } from "../world/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: { room: "start" },
};

const savedState = process.env.XDG_STATE_HOME;

beforeEach(() => {
  process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-save-state-"));
});
afterEach(() => {
  if (savedState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedState;
});

describe("saveGame / loadGame", () => {
  it("round-trips a game state", async () => {
    const state = newGameState(adventure, "now");
    expect(saveExists("a", "autosave")).toBe(false);
    await saveGame("a", "autosave", state);
    expect(saveExists("a", "autosave")).toBe(true);
    const loaded = await loadGame("a", "autosave");
    expect(loaded).toEqual(state);
  });

  it("throws SaveLoadError for a missing slot", async () => {
    await expect(loadGame("a", "nope")).rejects.toBeInstanceOf(SaveLoadError);
  });

  it("throws SaveLoadError for a corrupt save", async () => {
    await saveGame("a", "autosave", newGameState(adventure, "now"));
    writeFileSync(savePath("a", "autosave"), "{ not valid json", "utf8");
    await expect(loadGame("a", "autosave")).rejects.toBeInstanceOf(
      SaveLoadError,
    );
  });

  it("throws SaveLoadError for a schema-invalid save", async () => {
    await saveGame("a", "autosave", newGameState(adventure, "now"));
    writeFileSync(savePath("a", "autosave"), JSON.stringify({ turn: 1 }), "utf8");
    await expect(loadGame("a", "autosave")).rejects.toBeInstanceOf(
      SaveLoadError,
    );
  });
});

describe("listSaves", () => {
  it("returns an empty list when no saves directory exists", () => {
    expect(listSaves("a")).toEqual([]);
  });

  it("lists save slot names, sorted", async () => {
    const state = newGameState(adventure, "now");
    await saveGame("a", "autosave", state);
    await saveGame("a", "before-boss", state);
    expect(listSaves("a")).toEqual(["autosave", "before-boss"]);
  });
});

describe("global save location", () => {
  it("stores saves under $XDG_STATE_HOME/xyzzy/<adventure id>/saves, not inside the adventure directory", () => {
    expect(savePath("cave-of-echoes", "autosave")).toBe(
      join(
        process.env.XDG_STATE_HOME!,
        "xyzzy",
        "cave-of-echoes",
        "saves",
        "autosave.json",
      ),
    );
  });

  it("falls back to ~/.local/state/xyzzy when XDG_STATE_HOME is unset", () => {
    delete process.env.XDG_STATE_HOME;
    expect(savePath("cave-of-echoes", "autosave")).toContain(
      join(".local", "state", "xyzzy", "cave-of-echoes", "saves"),
    );
  });

  it("sanitizes an adventure id containing path-traversal characters", () => {
    const path = savePath("../../evil", "autosave");
    expect(path.startsWith(join(process.env.XDG_STATE_HOME!, "xyzzy"))).toBe(
      true,
    );
    expect(path).not.toContain("..");
  });
});
