import { describe, expect, it } from "vitest";
import { AdventureLoadError, loadAdventure, readAdventureFile } from "./loader.js";

const EXAMPLE = "examples/cave-of-echoes";

describe("loadAdventure", () => {
  it("loads and validates the Cave of Echoes example (directory path)", async () => {
    const adv = await loadAdventure(EXAMPLE);
    expect(adv.meta.id).toBe("cave-of-echoes");
    expect(adv.entities?.rooms).toHaveLength(4);
    expect(adv.entities?.characters?.[0]?.state.trust).toBe(10);
  });

  it("throws AdventureLoadError for a missing path", async () => {
    await expect(loadAdventure("does/not/exist")).rejects.toBeInstanceOf(
      AdventureLoadError,
    );
  });
});

describe("readAdventureFile", () => {
  it("returns a raw object without validating", () => {
    const raw = readAdventureFile(EXAMPLE) as { meta: { id: string } };
    expect(raw.meta.id).toBe("cave-of-echoes");
  });
});
