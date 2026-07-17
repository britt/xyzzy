import { afterEach, describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import {
  createDetector,
  listModels,
  NARRATION_TOOL_NAMES,
  ProviderError,
} from "./registry.js";
import type { ProviderConfig } from "../config/schema.js";

vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateObject: vi.fn(),
}));

const config: ProviderConfig = {
  kind: "openai-compatible",
  baseURL: "http://localhost:11434/v1",
  model: "llama3.1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("listModels", () => {
  it("requests /models and returns sorted ids", async () => {
    const spy = stubFetch(
      () =>
        new Response(
          JSON.stringify({ data: [{ id: "mistral" }, { id: "llama3.1" }] }),
          { status: 200 },
        ),
    );
    const models = await listModels(config);
    expect(models).toEqual(["llama3.1", "mistral"]);
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.anything(),
    );
  });

  it("strips a trailing slash from the base URL", async () => {
    const spy = stubFetch(
      () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    await listModels({ ...config, baseURL: "http://localhost:11434/v1/" });
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.anything(),
    );
  });

  it("throws ProviderError on a non-OK response", async () => {
    stubFetch(() => new Response("nope", { status: 500, statusText: "Boom" }));
    await expect(listModels(config)).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws ProviderError when the endpoint is unreachable", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(listModels(config)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("NARRATION_TOOL_NAMES", () => {
  it("excludes moveTo and advanceBeat (owned by detection)", () => {
    expect(NARRATION_TOOL_NAMES).not.toContain("moveTo");
    expect(NARRATION_TOOL_NAMES).not.toContain("advanceBeat");
  });

  it("keeps exactly the other narration mutation tools", () => {
    // Full-set assertion so an accidental future exclusion is caught.
    expect([...NARRATION_TOOL_NAMES].sort()).toEqual(
      [
        "addItem",
        "appendCharacterHistory",
        "moveCharacter",
        "removeItem",
        "setCharacterState",
        "setFlag",
        "setGameState",
      ].sort(),
    );
  });
});

describe("createDetector", () => {
  it("returns the validated object from a schema + context-built prompt", async () => {
    // generateObject is heavily overloaded; treat the mock loosely here so the
    // test can assert on the (schema, prompt) it receives without wire types.
    const mocked = generateObject as unknown as ReturnType<typeof vi.fn>;
    mocked.mockResolvedValue({ object: { move: "north", advancedBeats: [] } });

    const detector = createDetector(config);
    const out = await detector.detect({
      input: "go north",
      exits: [{ direction: "north", destination: "Hall" }],
      activeBeats: [{ id: "reach-hall", trigger: "player reaches the hall" }],
    });

    expect(out).toEqual({ move: "north", advancedBeats: [] });

    expect(mocked).toHaveBeenCalledTimes(1);
    const call = mocked.mock.calls[0]![0] as { schema: unknown; prompt: string };
    expect(call.schema).toBeDefined();
    const prompt = String(call.prompt);
    expect(prompt).toContain("go north");
    expect(prompt).toContain("north -> Hall");
    expect(prompt).toContain("reach-hall");
  });
});
