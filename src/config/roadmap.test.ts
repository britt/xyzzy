import { describe, it } from "vitest";

/** Placeholders for stubbed config store / resolution. */
describe("config (stubbed)", () => {
  it.todo("readGlobalConfig returns an empty config when the file is absent");
  it.todo("writeGlobalConfig round-trips through the schema");
  it.todo(
    "resolveProvider honors precedence: --provider → adventure → global default",
  );
});
