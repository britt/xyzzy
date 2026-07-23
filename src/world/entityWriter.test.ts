import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  entityFilePath,
  findEntityIdConflict,
  renderEntityYaml,
} from "./entityWriter.js";

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
  return mkdtempSync(join(tmpdir(), "xyzzy-entitywriter-"));
}

function writeAdventure(dir: string, yaml = MINIMAL_ADVENTURE): void {
  writeFileSync(join(dir, "adventure.yaml"), yaml, "utf8");
}

describe("renderEntityYaml", () => {
  describe("room", () => {
    it("writes all scalar fields when supplied", () => {
      const yaml = renderEntityYaml({
        kind: "room",
        id: "old-cistern",
        name: "Old Cistern",
        values: { description: "A dank stone cistern, long since run dry." },
      });
      expect(yaml).toBe(
        "id: old-cistern\n" +
          "name: Old Cistern\n" +
          "description: A dank stone cistern, long since run dry.\n" +
          "# exits:\n" +
          "#   north: <room id>\n",
      );
    });

    it("comments out skipped scalar fields with their placeholder", () => {
      const yaml = renderEntityYaml({
        kind: "room",
        id: "cistern",
        name: "Cistern",
        values: {},
      });
      expect(yaml).toBe(
        "id: cistern\n" +
          "name: Cistern\n" +
          "# description: <what the player sees when they enter>\n" +
          "# exits:\n" +
          "#   north: <room id>\n",
      );
    });
  });

  describe("item", () => {
    it("writes all scalar fields when supplied", () => {
      const yaml = renderEntityYaml({
        kind: "item",
        id: "rusted-key",
        name: "Rusted Key",
        values: {
          description: "A tarnished iron key, flecked with rust.",
          location: "old-cistern",
        },
      });
      expect(yaml).toBe(
        "id: rusted-key\n" +
          "name: Rusted Key\n" +
          "description: A tarnished iron key, flecked with rust.\n" +
          "location: old-cistern\n",
      );
    });

    it("comments out skipped scalar fields with their placeholder", () => {
      const yaml = renderEntityYaml({
        kind: "item",
        id: "rusted-key",
        name: "Rusted Key",
        values: {},
      });
      expect(yaml).toBe(
        "id: rusted-key\n" +
          "name: Rusted Key\n" +
          "# description: <what the player sees when they examine it>\n" +
          "# location: <room or character id where this item starts>\n",
      );
    });

    it("supports a mix of supplied and skipped fields", () => {
      const yaml = renderEntityYaml({
        kind: "item",
        id: "rusted-key",
        name: "Rusted Key",
        values: { description: "A tarnished iron key, flecked with rust." },
      });
      expect(yaml).toBe(
        "id: rusted-key\n" +
          "name: Rusted Key\n" +
          "description: A tarnished iron key, flecked with rust.\n" +
          "# location: <room or character id where this item starts>\n",
      );
    });
  });

  describe("character", () => {
    it("writes all scalar fields when supplied", () => {
      const yaml = renderEntityYaml({
        kind: "character",
        id: "old-hermit",
        name: "Old Hermit",
        values: {
          persona: "A reclusive hermit who trusts no one.",
          location: "cavern",
        },
      });
      expect(yaml).toBe(
        "id: old-hermit\n" +
          "name: Old Hermit\n" +
          "persona: A reclusive hermit who trusts no one.\n" +
          "location: cavern\n" +
          "# history: []\n" +
          "# state: {}\n" +
          "# beats:\n" +
          "#   - id: <beat id>\n" +
          "#     description: <what happens>\n",
      );
    });

    it("comments out skipped scalar fields with their placeholder", () => {
      const yaml = renderEntityYaml({
        kind: "character",
        id: "old-hermit",
        name: "Old Hermit",
        values: {},
      });
      expect(yaml).toBe(
        "id: old-hermit\n" +
          "name: Old Hermit\n" +
          "# persona: <how this character speaks and behaves>\n" +
          "# location: <room id where this character starts>\n" +
          "# history: []\n" +
          "# state: {}\n" +
          "# beats:\n" +
          "#   - id: <beat id>\n" +
          "#     description: <what happens>\n",
      );
    });
  });

  describe("beat", () => {
    it("writes all scalar fields when supplied, with no name field", () => {
      const yaml = renderEntityYaml({
        kind: "beat",
        id: "won-the-key",
        values: {
          description: "The player receives the rusted key.",
          trigger: "The player picks up the rusted key.",
        },
      });
      expect(yaml).toBe(
        "id: won-the-key\n" +
          "description: The player receives the rusted key.\n" +
          "trigger: The player picks up the rusted key.\n" +
          "# effects:\n" +
          "#   - type: setGameState\n" +
          "#     key: <flag>\n" +
          "#     value: <value>\n",
      );
    });

    it("comments out skipped scalar fields with their placeholder", () => {
      const yaml = renderEntityYaml({
        kind: "beat",
        id: "won-the-key",
        values: {},
      });
      expect(yaml).toBe(
        "id: won-the-key\n" +
          "# description: <what happens>\n" +
          "# trigger: <trigger notes surfaced to the model>\n" +
          "# effects:\n" +
          "#   - type: setGameState\n" +
          "#     key: <flag>\n" +
          "#     value: <value>\n",
      );
    });
  });
});

describe("entityFilePath", () => {
  it("pluralizes each kind's directory", () => {
    expect(entityFilePath("/adv", "room", "cavern")).toBe(
      "/adv/rooms/cavern.yaml",
    );
    expect(entityFilePath("/adv", "item", "rusted-key")).toBe(
      "/adv/items/rusted-key.yaml",
    );
    expect(entityFilePath("/adv", "character", "old-hermit")).toBe(
      "/adv/characters/old-hermit.yaml",
    );
    expect(entityFilePath("/adv", "beat", "won-the-key")).toBe(
      "/adv/beats/won-the-key.yaml",
    );
  });
});

describe("findEntityIdConflict", () => {
  it("returns undefined for a fresh id", () => {
    const dir = tmp();
    writeAdventure(dir);
    expect(findEntityIdConflict(dir, "room", "lake")).toBeUndefined();
  });

  it("returns a defined value when the id already exists inline in adventure.yaml", () => {
    const dir = tmp();
    writeAdventure(dir);
    expect(findEntityIdConflict(dir, "room", "cavern")).toBeDefined();
  });

  it("returns a defined value when the id already exists in another file under the kind directory", () => {
    const dir = tmp();
    writeAdventure(dir);
    mkdirSync(join(dir, "items"));
    writeFileSync(
      join(dir, "items", "coin.yaml"),
      "id: coin\nname: Old Coin\ndescription: A tarnished coin.\n",
      "utf8",
    );
    expect(findEntityIdConflict(dir, "item", "coin")).toBeDefined();
  });

  it("checks the top-level beats list for kind beat, not entities", () => {
    const dir = tmp();
    writeAdventure(
      dir,
      MINIMAL_ADVENTURE +
        "beats:\n" +
        "  - id: find-light\n" +
        "    description: The player lights the lantern.\n",
    );
    expect(findEntityIdConflict(dir, "beat", "find-light")).toBeDefined();
    expect(findEntityIdConflict(dir, "room", "find-light")).toBeUndefined();
  });
});
