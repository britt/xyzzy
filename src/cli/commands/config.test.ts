import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configAdd,
  configList,
  configModels,
  configTest,
  configUse,
} from "./config.js";
import { readGlobalConfig } from "../../config/store.js";

const savedXdg = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "xyzzy-cfgcmd-"));
});

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureLog() {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  return () => spy.mock.calls.map((c) => c.join(" ")).join("\n");
}

describe("config add", () => {
  it("adds a provider and makes the first one the default", async () => {
    await configAdd("lm", {
      kind: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "phi3",
    });
    const cfg = await readGlobalConfig();
    expect(cfg.providers.lm).toEqual({
      kind: "openai-compatible",
      baseURL: "http://localhost:1234/v1",
      model: "phi3",
    });
    expect(cfg.default).toBe("lm");
  });

  it("keeps the existing default when adding more providers", async () => {
    await configAdd("a", { model: "m1" });
    await configAdd("b", { model: "m2" });
    expect((await readGlobalConfig()).default).toBe("a");
  });

  it("requires a model", async () => {
    await expect(configAdd("x", {})).rejects.toThrow(/model is required/);
  });

  it("rejects an invalid base URL", async () => {
    await expect(
      configAdd("x", { model: "m", baseUrl: "not-a-url" }),
    ).rejects.toThrow();
  });
});

describe("config use", () => {
  it("sets the default to an existing provider", async () => {
    await configAdd("a", { model: "m1" });
    await configAdd("b", { model: "m2" });
    await configUse("b");
    expect((await readGlobalConfig()).default).toBe("b");
  });

  it("throws for an unknown provider", async () => {
    await expect(configUse("ghost")).rejects.toThrow(/Unknown provider/);
  });
});

describe("config list", () => {
  it("marks the default provider", async () => {
    await configAdd("a", { model: "m1" });
    await configAdd("b", { model: "m2" });
    const out = captureLog();
    await configList();
    expect(out()).toContain("* a");
    expect(out()).toContain("  b");
  });

  it("reports when nothing is configured", async () => {
    const out = captureLog();
    await configList();
    expect(out()).toContain("No providers configured");
  });
});

describe("config test", () => {
  it("pings the endpoint and reports available models", async () => {
    const out = captureLog();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await configAdd("a", { baseUrl: "http://localhost:9/v1", model: "m1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: "m1" }] }), {
            status: 200,
          }),
      ),
    );

    await configTest("a");
    expect(out()).toContain("ok (1 model(s) available)");
  });

  it("throws when the endpoint is unreachable", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await configAdd("a", { baseUrl: "http://localhost:9/v1", model: "m1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(configTest("a")).rejects.toThrow();
  });
});

describe("config models", () => {
  it("lists every model the endpoint reports", async () => {
    const out = captureLog();
    await configAdd("a", { baseUrl: "http://localhost:9/v1", model: "m1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ id: "gpt-4o" }, { id: "o1" }, { id: "gpt-3.5" }],
            }),
            { status: 200 },
          ),
      ),
    );

    await configModels("a");
    const printed = out();
    expect(printed).toContain("gpt-4o");
    expect(printed).toContain("o1");
    expect(printed).toContain("gpt-3.5");
  });

  it("reports when the endpoint lists no models", async () => {
    const out = captureLog();
    await configAdd("a", { baseUrl: "http://localhost:9/v1", model: "m1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );

    await configModels("a");
    expect(out()).toContain("No models");
  });

  it("throws when the endpoint is unreachable", async () => {
    await configAdd("a", { baseUrl: "http://localhost:9/v1", model: "m1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(configModels("a")).rejects.toThrow();
  });
});
