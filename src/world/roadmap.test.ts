import { describe, it } from "vitest";

/** Placeholders for stubbed world loader / validator / scaffolder. */
describe("world (stubbed)", () => {
  it.todo("loadAdventure parses YAML and validates against the schema");
  it.todo("validateAdventure reports zod issues with dotted paths");
  it.todo("checkCrossReferences flags exits/locations pointing to unknown ids");
  it.todo("scaffoldAdventure writes a minimal adventure and refuses overwrite");
});
