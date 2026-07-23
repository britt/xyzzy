import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { newAdventure } from "./new.js";

function fakePrompter(answers: string[]) {
  let i = 0;
  return { question: vi.fn(async () => answers[i++] ?? "") };
}

describe("newAdventure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prompts for a title and premise, then scaffolds the adventure", async () => {
    const dir = join(
      mkdtempSync(join(tmpdir(), "xyzzy-new-")),
      "castle-of-doom",
    );
    const prompter = fakePrompter(["Castle of Doom", "A grim keep on a hill."]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await newAdventure(dir, prompter);

    const adventure = parseYaml(
      readFileSync(join(dir, "adventure.yaml"), "utf8"),
    ) as {
      meta: { id: string; title: string };
      premise: string;
    };
    expect(adventure.meta.id).toBe("castle-of-doom");
    expect(adventure.meta.title).toBe("Castle of Doom");
    expect(adventure.premise).toBe("A grim keep on a hill.");
    expect(prompter.question).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(dir));
  });

  it("defaults the title to the directory name when left blank", async () => {
    const dir = join(
      mkdtempSync(join(tmpdir(), "xyzzy-new-")),
      "unnamed-quest",
    );
    const prompter = fakePrompter(["", ""]);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newAdventure(dir, prompter);

    const adventure = parseYaml(
      readFileSync(join(dir, "adventure.yaml"), "utf8"),
    ) as {
      meta: { title: string };
    };
    expect(adventure.meta.title).toBe("unnamed-quest");
  });

  it("leaves the premise as a placeholder when skipped", async () => {
    const dir = join(
      mkdtempSync(join(tmpdir(), "xyzzy-new-")),
      "empty-premise",
    );
    const prompter = fakePrompter(["Empty Premise", "   "]);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await newAdventure(dir, prompter);

    const adventure = parseYaml(
      readFileSync(join(dir, "adventure.yaml"), "utf8"),
    ) as {
      premise: string;
    };
    expect(adventure.premise.length).toBeGreaterThan(0);
    expect(adventure.premise.trim()).not.toBe("");
  });
});
