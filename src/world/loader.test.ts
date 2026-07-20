import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AdventureLoadError, loadAdventure, readAdventureFile } from "./loader.js";

const EXAMPLE = "examples/cave-of-echoes";

const MINIMAL_ADVENTURE = `
meta:
  id: a
  title: A
  version: "1"
premise: p
start: {}
`;

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "xyzzy-loader-"));
}

function writeAdventure(dir: string, yaml = MINIMAL_ADVENTURE): void {
  writeFileSync(join(dir, "adventure.yaml"), yaml, "utf8");
}

describe("loadAdventure", () => {
  it("loads and validates the Cave of Echoes example (directory path), split across conventional directories", async () => {
    const adv = await loadAdventure(EXAMPLE);
    expect(adv.meta.id).toBe("cave-of-echoes");
    expect(adv.entities?.rooms).toHaveLength(4);
    expect(adv.entities?.items).toHaveLength(4);
    expect(adv.beats).toHaveLength(3);
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

  it("merges a single-entity file from a conventional directory", () => {
    const dir = tmp();
    writeAdventure(dir);
    mkdirSync(join(dir, "rooms"));
    writeFileSync(
      join(dir, "rooms", "hall.yaml"),
      "id: hall\nname: Hall\ndescription: d\n",
      "utf8",
    );

    const raw = readAdventureFile(dir) as {
      entities: { rooms: { id: string }[] };
    };
    expect(raw.entities.rooms.map((r) => r.id)).toEqual(["hall"]);
  });

  it("merges a multi-entity (array) file from a conventional directory", () => {
    const dir = tmp();
    writeAdventure(dir);
    mkdirSync(join(dir, "rooms"));
    writeFileSync(
      join(dir, "rooms", "many.yaml"),
      "- id: a\n  name: A\n  description: d\n- id: b\n  name: B\n  description: d\n",
      "utf8",
    );

    const raw = readAdventureFile(dir) as {
      entities: { rooms: { id: string }[] };
    };
    expect(raw.entities.rooms.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("merges beats from a conventional beats/ directory", () => {
    const dir = tmp();
    writeAdventure(dir);
    mkdirSync(join(dir, "beats"));
    writeFileSync(
      join(dir, "beats", "b1.yaml"),
      "id: opening\ndescription: d\n",
      "utf8",
    );

    const raw = readAdventureFile(dir) as { beats: { id: string }[] };
    expect(raw.beats.map((b) => b.id)).toEqual(["opening"]);
  });

  it("appends directory entities after inline entities of the same kind", () => {
    const dir = tmp();
    writeAdventure(
      dir,
      `${MINIMAL_ADVENTURE}\nentities:\n  rooms:\n    - id: inline\n      name: Inline\n      description: d\n`,
    );
    mkdirSync(join(dir, "rooms"));
    writeFileSync(
      join(dir, "rooms", "extra.yaml"),
      "id: fromdir\nname: FromDir\ndescription: d\n",
      "utf8",
    );

    const raw = readAdventureFile(dir) as {
      entities: { rooms: { id: string }[] };
    };
    expect(raw.entities.rooms.map((r) => r.id)).toEqual(["inline", "fromdir"]);
  });

  it("throws AdventureLoadError on a duplicate id across sources", () => {
    const dir = tmp();
    writeAdventure(dir);
    mkdirSync(join(dir, "rooms"));
    writeFileSync(
      join(dir, "rooms", "one.yaml"),
      "id: hall\nname: Hall\ndescription: d\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "rooms", "two.yaml"),
      "id: hall\nname: Hall Again\ndescription: d\n",
      "utf8",
    );

    expect(() => readAdventureFile(dir)).toThrow(AdventureLoadError);
    expect(() => readAdventureFile(dir)).toThrow(/Duplicate rooms id "hall"/);
  });

  it("ignores a missing conventional directory", () => {
    const dir = tmp();
    writeAdventure(dir);
    const raw = readAdventureFile(dir) as { entities?: unknown };
    expect(raw.entities).toBeUndefined();
  });
});
