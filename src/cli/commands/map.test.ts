import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { map } from "./map.js";

const adventureYaml = {
  meta: { id: "cave", title: "Cave of Echoes", version: "1" },
  premise: "A test premise.",
  start: { room: "entrance" },
  entities: {
    rooms: [
      { id: "entrance", name: "Cave Mouth", description: "d", exits: { down: "cavern" } },
      {
        id: "cavern",
        name: "Great Cavern",
        description: "d",
        exits: { up: "entrance", north: "lake" },
      },
      { id: "lake", name: "Still Lake", description: "d", exits: { south: "cavern" } },
    ],
    characters: [
      {
        id: "grimble",
        name: "Grimble",
        persona: "a troll",
        location: "lake",
        history: [],
        state: {},
      },
    ],
  },
};

describe("map command", () => {
  it("writes map.yaml beside adventure.yaml with layout, exits, and an ASCII rendering", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-map-"));
    writeFileSync(join(dir, "adventure.yaml"), stringify(adventureYaml), "utf8");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await map(dir);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("map.yaml"));

    const written = parseYaml(readFileSync(join(dir, "map.yaml"), "utf8")) as {
      title: string;
      rooms: Array<{ id: string; name: string; exits: Record<string, string> }>;
      ascii: string;
    };

    expect(written.title).toBe("Cave of Echoes");
    expect(written.rooms).toHaveLength(3);
    const cavern = written.rooms.find((r) => r.id === "cavern")!;
    expect(cavern.exits).toEqual({ up: "entrance", north: "lake" });
    expect(typeof written.ascii).toBe("string");
    expect(written.ascii).toContain("Cave Mouth");
    expect(written.ascii).toContain("Grimble");

    logSpy.mockRestore();
  });
});
