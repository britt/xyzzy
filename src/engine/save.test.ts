import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGame, SaveLoadError, saveExists, saveGame } from "./save.js";
import { newGameState } from "./state.js";
import { savePath } from "./save.js";
import type { Adventure } from "../world/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: { room: "start" },
};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "xyzzy-save-"));
}

describe("saveGame / loadGame", () => {
  it("round-trips a game state", async () => {
    const dir = tmp();
    const state = newGameState(adventure, "now");
    expect(saveExists(dir, "autosave")).toBe(false);
    await saveGame(dir, "autosave", state);
    expect(saveExists(dir, "autosave")).toBe(true);
    const loaded = await loadGame(dir, "autosave");
    expect(loaded).toEqual(state);
  });

  it("throws SaveLoadError for a missing slot", async () => {
    await expect(loadGame(tmp(), "nope")).rejects.toBeInstanceOf(SaveLoadError);
  });

  it("throws SaveLoadError for a corrupt save", async () => {
    const dir = tmp();
    await saveGame(dir, "autosave", newGameState(adventure, "now"));
    writeFileSync(savePath(dir, "autosave"), "{ not valid json", "utf8");
    await expect(loadGame(dir, "autosave")).rejects.toBeInstanceOf(
      SaveLoadError,
    );
  });

  it("throws SaveLoadError for a schema-invalid save", async () => {
    const dir = tmp();
    await saveGame(dir, "autosave", newGameState(adventure, "now"));
    writeFileSync(savePath(dir, "autosave"), JSON.stringify({ turn: 1 }), "utf8");
    await expect(loadGame(dir, "autosave")).rejects.toBeInstanceOf(
      SaveLoadError,
    );
  });
});
