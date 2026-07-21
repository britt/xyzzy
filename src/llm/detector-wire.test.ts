import { afterEach, describe, expect, it, vi } from "vitest";
import { createDetector } from "./registry.js";
import type { ProviderConfig } from "../config/schema.js";
import type { DetectionContext } from "./Detector.js";

// This test does NOT mock the `ai` SDK: it drives the real generateObject call
// through a stubbed fetch so it can inspect the actual request body the provider
// sends. It guards the structured-output wire format per provider kind — the
// thing that broke against LM Studio (see xyzzy.log): LM Studio rejects both an
// object `tool_choice` AND a bare `{type:"json_object"}`, accepting only
// `json_schema`. Generic openai-compatible servers get `json_object`.

const ctx: DetectionContext = {
  input: "go down",
  exits: [{ direction: "down", destination: "The Great Cavern" }],
  activeBeats: [],
  characterBeats: [],
  interactions: [],
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

/** Run one detect() against a stubbed fetch and return the parsed request body. */
async function captureRequest(config: ProviderConfig) {
  const fetchMock = vi.fn(
    async (_url: string | URL, _init?: RequestInit) =>
      chatCompletion({ move: "down", advancedBeats: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const detection = await createDetector(config).detect(ctx);
  const init = fetchMock.mock.calls[0]![1]!;
  return { detection, body: JSON.parse(init.body as string) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createDetector wire format", () => {
  // LM Studio rejects both an object `tool_choice` and `{type:"json_object"}`,
  // accepting only `json_schema`. That is the family default, so BOTH the
  // explicit lmstudio kind and a generic openai-compatible config send it.
  for (const kind of ["lmstudio", "openai-compatible"] as const) {
    it(`sends a json_schema response_format for the ${kind} kind`, async () => {
      const { detection, body } = await captureRequest({
        kind,
        baseURL: "http://localhost:9/v1",
        model: "m1",
      });
      expect(detection).toEqual({
        move: "down",
        advancedBeats: [],
        advancedCharacterBeats: [],
        triggeredInteractions: [],
      });
      expect(body.tool_choice).toBeUndefined();
      expect(body.response_format?.type).toBe("json_schema");
      expect(body.response_format?.json_schema?.schema).toBeDefined();
      expect(
        body.response_format.json_schema.schema.properties.move.enum,
      ).toEqual(["none", "down"]);
    });
  }
});
