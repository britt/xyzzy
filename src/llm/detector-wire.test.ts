import { afterEach, describe, expect, it, vi } from "vitest";
import { createDetector } from "./registry.js";
import type { ProviderConfig } from "../config/schema.js";
import type { DetectionContext } from "./Detector.js";

// This test does NOT mock the `ai` SDK: it drives the real generateObject call
// through a stubbed fetch so it can inspect the actual request body the provider
// sends. It guards the wire format — specifically that structured output goes
// out as a `response_format` (JSON mode), NOT as an object `tool_choice`, which
// local servers like LM Studio reject with HTTP 400. See xyzzy.log.

const config: ProviderConfig = {
  kind: "openai-compatible",
  baseURL: "http://localhost:9/v1",
  model: "m1",
};

const ctx: DetectionContext = {
  input: "go down",
  exits: [{ direction: "down", destination: "The Great Cavern" }],
  activeBeats: [],
};

/** A minimal, valid OpenAI chat-completion whose content is the JSON object. */
function chatCompletion(obj: unknown): Response {
  return new Response(
    JSON.stringify({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "m1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(obj) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createDetector wire format", () => {
  it("requests a json_schema response_format, not tool_choice or json_object", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        chatCompletion({ move: "down", advancedBeats: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const detection = await createDetector(config).detect(ctx);
    expect(detection).toEqual({ move: "down", advancedBeats: [] });

    // Inspect what actually went over the wire. LM Studio rejects BOTH an
    // object tool_choice AND a bare {type:"json_object"} — it requires
    // response_format.type === "json_schema" with the schema attached.
    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);
    expect(body.tool_choice).toBeUndefined();
    expect(body.response_format?.type).toBe("json_schema");
    expect(body.response_format?.json_schema?.schema).toBeDefined();
    // The schema must actually constrain the move to the real exits.
    expect(body.response_format.json_schema.schema.properties.move.enum).toEqual(
      ["none", "down"],
    );
  });
});
