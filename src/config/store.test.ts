import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalConfigPath, readGlobalConfig, writeGlobalConfig } from "./store.js";

const savedXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "xyzzy-store-"));
});

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
});

describe("global config store", () => {
  it("puts config.json under $XDG_CONFIG_HOME/xyzzy", () => {
    expect(globalConfigPath()).toMatch(/xyzzy[/\\]config\.json$/);
  });

  it("returns an empty config when the file is absent", async () => {
    expect(await readGlobalConfig()).toEqual({ providers: {} });
  });

  it("round-trips through write + read", async () => {
    const config = {
      providers: {
        lm: {
          kind: "openai-compatible" as const,
          baseURL: "http://localhost:1234/v1",
          model: "mistral",
        },
      },
      default: "lm",
    };
    await writeGlobalConfig(config);
    expect(await readGlobalConfig()).toEqual(config);
  });
});
