import { describe, it } from "vitest";

/**
 * Placeholders for stubbed engine functionality. Each `it.todo` becomes a real
 * test as its layer is implemented (drives the TDD build-out in the design's
 * testing plan).
 */
describe("engine (stubbed)", () => {
  it.todo("newGameState seeds state from an adventure's start block");
  it.todo("buildDigest renders room, entities, inventory, and active beats");
  it.todo("appendMessage / windowTranscript manage the transcript window");
  it.todo("saveGame writes atomically and loadGame validates + version-checks");
  it.todo("runTurn folds validated tool-calls and rolls back on model error");
});
