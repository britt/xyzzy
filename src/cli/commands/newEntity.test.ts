import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newEntity } from "./newEntity.js";

const MINIMAL_ADVENTURE = `
meta:
  id: a
  title: A
  version: "1"
premise: p
start: {}
entities:
  rooms:
    - id: cavern
      name: The Great Cavern
      description: An immense vaulted space.
`;

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "xyzzy-newentity-"));
}

function writeAdventure(dir: string, yaml = MINIMAL_ADVENTURE): void {
  writeFileSync(join(dir, "adventure.yaml"), yaml, "utf8");
}

describe("newEntity", () => {
  it("writes a file with no placeholders when all relevant flags are supplied", async () => {
    const dir = tmp();
    writeAdventure(dir);

    await newEntity({
      kind: "room",
      positional: "Old Cistern",
      adventure: dir,
      description: "A dank stone cistern, long since run dry.",
      nonInteractive: true,
    });

    const content = readFileSync(join(dir, "rooms", "old-cistern.yaml"), "utf8");
    expect(content).toContain("id: old-cistern");
    expect(content).toContain("name: Old Cistern");
    expect(content).toContain(
      "description: A dank stone cistern, long since run dry.",
    );
    expect(content).not.toContain("# description");
  });

  it("leaves missing fields as commented placeholders when non-interactive", async () => {
    const dir = tmp();
    writeAdventure(dir);

    await newEntity({
      kind: "item",
      positional: "Rusted Key",
      adventure: dir,
      nonInteractive: true,
    });

    const content = readFileSync(join(dir, "items", "rusted-key.yaml"), "utf8");
    expect(content).toContain("# description: <");
    expect(content).toContain("# location: <");
  });

  it("uses the positional as the id directly for a beat, with no name field", async () => {
    const dir = tmp();
    writeAdventure(dir);

    await newEntity({
      kind: "beat",
      positional: "won-the-key",
      adventure: dir,
      description: "The player receives the rusted key.",
      nonInteractive: true,
    });

    const content = readFileSync(join(dir, "beats", "won-the-key.yaml"), "utf8");
    expect(content).toBe(
      "id: won-the-key\n" +
        "description: The player receives the rusted key.\n" +
        "# trigger: <trigger notes surfaced to the model>\n" +
        "# effects:\n" +
        "#   - type: setGameState\n" +
        "#     key: <flag>\n" +
        "#     value: <value>\n",
    );
  });

  it("rejects when the target adventure directory has no adventure.yaml", async () => {
    const dir = tmp();

    await expect(
      newEntity({
        kind: "room",
        positional: "Old Cistern",
        adventure: dir,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/no such adventure/i);
  });

  it("rejects when the id collides with an existing entity", async () => {
    const dir = tmp();
    writeAdventure(dir);

    await expect(
      newEntity({
        kind: "room",
        positional: "Cavern",
        adventure: dir,
        nonInteractive: true,
      }),
    ).rejects.toThrow(/cavern/i);
  });
});
