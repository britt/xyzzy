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
  it("requests JSON via response_format, not an object tool_choice", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        chatCompletion({ move: "down", advancedBeats: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const detection = await createDetector(config).detect(ctx);
    expect(detection).toEqual({ move: "down", advancedBeats: [] });

    // Inspect what actually went over the wire.
    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toBeDefined();
    // LM Studio only accepts string tool_choice; an object one is the bug.
    expect(body.tool_choice).toBeUndefined();
  });
});
