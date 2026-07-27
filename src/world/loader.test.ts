import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AdventureLoadError,
  loadAdventure,
  readAdventureFile,
  readAdventureFileWithSources,
} from "./loader.js";

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

  it("merges entities from arbitrarily nested subfolders of a conventional directory", () => {
    const dir = tmp();
    writeAdventure(dir);
    mkdirSync(join(dir, "characters"));
    mkdirSync(join(dir, "characters", "trolls"), { recursive: true });
    writeFileSync(
      join(dir, "characters", "dave.yaml"),
      "id: dave\nname: Dave\nstate: {}\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "characters", "trolls", "grimble.yaml"),
      "id: grimble\nname: Grimble\nstate: {}\n",
      "utf8",
    );

    const raw = readAdventureFile(dir) as {
      entities: { characters: { id: string }[] };
    };
    expect(raw.entities.characters.map((c) => c.id).sort()).toEqual([
      "dave",
      "grimble",
    ]);
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

describe("readAdventureFileWithSources", () => {
  it("maps every entity to the file it was actually defined in, for the real example adventure", () => {
    const { sources } = readAdventureFileWithSources(EXAMPLE);

    // rooms/cave.yaml holds two rooms; neither filename matches an id.
    expect(sources.get("room:entrance")).toBe(join(EXAMPLE, "rooms", "cave.yaml"));
    expect(sources.get("room:cavern")).toBe(join(EXAMPLE, "rooms", "cave.yaml"));
    // ...while these files happen to be named after their single entity.
    expect(sources.get("room:lake")).toBe(join(EXAMPLE, "rooms", "lake.yaml"));
    expect(sources.get("character:grimble")).toBe(
      join(EXAMPLE, "characters", "grimble.yaml"),
    );
    // items/items.yaml holds four items under one unrelated filename.
    expect(sources.get("item:lantern")).toBe(join(EXAMPLE, "items", "items.yaml"));
    expect(sources.get("item:copper-coin")).toBe(join(EXAMPLE, "items", "items.yaml"));
    // beats/grimble-and-treasure.yaml holds two beats.
    expect(sources.get("beat:win-over-grimble")).toBe(
      join(EXAMPLE, "beats", "grimble-and-treasure.yaml"),
    );
  });

  it("attributes inline entities to adventure.yaml itself", () => {
    const dir = tmp();
    writeAdventure(
      dir,
      `
meta:
  id: a
  title: A
  version: "1"
premise: p
start: {}
entities:
  rooms:
    - id: inline-room
      name: Inline
      description: d
beats:
  - id: inline-beat
    description: d
`,
    );
    const { sources } = readAdventureFileWithSources(dir);
    expect(sources.get("room:inline-room")).toBe(join(dir, "adventure.yaml"));
    expect(sources.get("beat:inline-beat")).toBe(join(dir, "adventure.yaml"));
  });

  it("returns the same raw value readAdventureFile does", () => {
    expect(readAdventureFileWithSources(EXAMPLE).raw).toEqual(
      readAdventureFile(EXAMPLE),
    );
  });
});
