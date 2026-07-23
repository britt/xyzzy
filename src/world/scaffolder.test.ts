import {
  mkdirSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { scaffoldAdventure } from "./scaffolder.js";
import { validateAdventure } from "./validator.js";
import { readAdventureFile } from "./loader.js";

function tmpDir(): string {
  return join(mkdtempSync(join(tmpdir(), "xyzzy-scaffold-")), "my-adventure");
}

describe("scaffoldAdventure", () => {
  it("writes a minimal, schema-valid adventure.yaml", async () => {
    const dir = tmpDir();
    await scaffoldAdventure({
      dir,
      title: "My Grand Adventure",
      premise: "A test premise.",
    });

    const raw = readAdventureFile(dir);
    const result = validateAdventure(raw);
    expect(result.ok).toBe(true);

    const adventure = raw as {
      meta: { id: string; title: string; version: string };
      premise: string;
    };
    expect(adventure.meta.id).toBe("my-adventure");
    expect(adventure.meta.title).toBe("My Grand Adventure");
    expect(adventure.premise).toBe("A test premise.");
  });

  it("fills in a placeholder premise when none is given", async () => {
    const dir = tmpDir();
    await scaffoldAdventure({ dir, title: "No Premise Yet" });

    const raw = readAdventureFile(dir);
    const result = validateAdventure(raw);
    expect(result.ok).toBe(true);

    const adventure = raw as { premise: string };
    expect(adventure.premise.length).toBeGreaterThan(0);
  });

  it("creates a saves/ directory", async () => {
    const dir = tmpDir();
    await scaffoldAdventure({ dir, title: "Save Test" });

    expect(statSync(join(dir, "saves")).isDirectory()).toBe(true);
  });

  it("writes a README", async () => {
    const dir = tmpDir();
    await scaffoldAdventure({ dir, title: "Readme Test" });

    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("Readme Test");
  });

  it("references the actual directory name (not the slugified id) in the README's usage snippets", async () => {
    const base = mkdtempSync(join(tmpdir(), "xyzzy-scaffold-"));
    const dir = join(base, "My Cool Adventure!!!");
    await scaffoldAdventure({ dir, title: "Whatever" });

    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("My Cool Adventure!!!");
    expect(readme).not.toContain("my-cool-adventure");
  });

  it("writes commented example room, item, character, and beat files that don't add real entities", async () => {
    const dir = tmpDir();
    await scaffoldAdventure({ dir, title: "Examples Test" });

    const kinds = ["rooms", "items", "characters", "beats"] as const;
    for (const subdir of kinds) {
      const file = "example.yaml";
      const full = join(dir, subdir, file);
      expect(existsSync(full)).toBe(true);
      const text = readFileSync(full, "utf8");
      // Every non-blank line is a comment: the example is illustrative only.
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        expect(line.trimStart().startsWith("#")).toBe(true);
      }
      // A commented-out file parses to nothing, so it contributes no entities.
      expect(parseYaml(text)).toBeNull();
    }

    const raw = readAdventureFile(dir);
    const adventure = raw as { entities?: unknown };
    expect(adventure.entities).toBeUndefined();
  });

  it("slugifies an untidy directory name into meta.id", async () => {
    const base = mkdtempSync(join(tmpdir(), "xyzzy-scaffold-"));
    const dir = join(base, "My Cool Adventure!!!");
    await scaffoldAdventure({ dir, title: "Whatever" });

    const raw = readAdventureFile(dir) as { meta: { id: string } };
    expect(raw.meta.id).toBe("my-cool-adventure");
  });

  it("refuses to overwrite an existing non-empty directory", async () => {
    const dir = tmpDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "keep-me.txt"), "pre-existing", "utf8");

    await expect(scaffoldAdventure({ dir, title: "Nope" })).rejects.toThrow(
      /already exists|not empty/i,
    );
  });

  it("is fine with an existing empty directory", async () => {
    const dir = tmpDir();
    mkdirSync(dir, { recursive: true });

    await expect(
      scaffoldAdventure({ dir, title: "Empty Dir Is Fine" }),
    ).resolves.not.toThrow();
  });
});
