import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER, resolveProvider } from "./resolve.js";
import { writeGlobalConfig } from "./store.js";

let configHome: string;
const savedXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "xyzzy-cfg-"));
  process.env.XDG_CONFIG_HOME = configHome;
});

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
});

const local = {
  kind: "openai-compatible" as const,
  baseURL: "http://localhost:1234/v1",
  model: "mistral",
};

describe("resolveProvider", () => {
  it("falls back to the built-in default when nothing is configured", async () => {
    expect(await resolveProvider({})).toEqual(DEFAULT_PROVIDER);
  });

  it("uses the global default provider", async () => {
    await writeGlobalConfig({ providers: { lm: local }, default: "lm" });
    expect(await resolveProvider({})).toEqual(local);
  });

  it("honors the --provider flag over the global default", async () => {
    const other = { ...local, model: "phi" };
    await writeGlobalConfig({
      providers: { lm: local, other },
      default: "lm",
    });
    expect(await resolveProvider({ providerFlag: "other" })).toEqual(other);
  });

  it("throws for an unknown provider name", async () => {
    await expect(resolveProvider({ providerFlag: "ghost" })).rejects.toThrow(
      /Unknown provider/,
    );
  });

  it("applies a per-adventure model override", async () => {
    await writeGlobalConfig({ providers: { lm: local }, default: "lm" });
    const advDir = mkdtempSync(join(tmpdir(), "xyzzy-adv-"));
    writeFileSync(
      join(advDir, "xyzzy.config.json"),
      JSON.stringify({ model: "codellama" }),
      "utf8",
    );
    const resolved = await resolveProvider({ adventureDir: advDir });
    expect(resolved.model).toBe("codellama");
    expect(resolved.baseURL).toBe(local.baseURL);
  });

  it("resolves the provider name from adventure config", async () => {
    await writeGlobalConfig({ providers: { lm: local } });
    const advDir = mkdtempSync(join(tmpdir(), "xyzzy-adv-"));
    writeFileSync(
      join(advDir, "xyzzy.config.json"),
      JSON.stringify({ provider: "lm" }),
      "utf8",
    );
    expect(await resolveProvider({ adventureDir: advDir })).toEqual(local);
  });
});
