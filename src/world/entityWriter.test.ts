import { describe, expect, it } from "vitest";
import { renderEntityYaml } from "./entityWriter.js";

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
