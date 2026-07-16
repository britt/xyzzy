import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, ProviderError } from "./registry.js";
import type { ProviderConfig } from "../config/schema.js";

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
