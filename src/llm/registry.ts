import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateObject,
  generateText,
  tool,
  type CoreMessage,
  type LanguageModel,
} from "ai";
import type { Action } from "../world/actions.js";
import type { ProviderConfig } from "../config/schema.js";
import type { Message } from "../world/schema.js";
import {
  type NarratorContext,
  type NarratorModel,
  type NarratorResult,
} from "./NarratorModel.js";
import type { Detection, Detector } from "./Detector.js";
import { buildDetectionSchema } from "./detection.js";
import { ACTION_TOOLS, toAction } from "./tools.js";

/** Max tool-loop steps per turn (model may narrate + emit several mutations). */
const MAX_STEPS = 6;

/** Action types the detection pre-pass owns; not offered to the narration model. */
const DETECTION_OWNED = ["moveTo", "advanceBeat"] as const;

/**
 * The tool names the narration model is offered: every reducer action tool
 * except the detection-owned movement/beat ones (which the pre-pass decides).
 */
export const NARRATION_TOOL_NAMES = (
  Object.keys(ACTION_TOOLS) as (keyof typeof ACTION_TOOLS)[]
).filter(
  (n) => !DETECTION_OWNED.includes(n as (typeof DETECTION_OWNED)[number]),
);

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Resolve the base URL for a provider, falling back to the local Ollama one. */
function resolveBaseURL(config: ProviderConfig): string {
  return (config.baseURL ?? "http://localhost:11434/v1").replace(/\/$/, "");
}

/**
 * List the model ids the provider's endpoint reports, via the OpenAI-compatible
 * `GET /models` route (supported by Ollama, LM Studio, llama.cpp, vLLM, …).
 * Throws {@link ProviderError} if the endpoint is unreachable or errors.
 */
/** How long to wait for the model-list endpoint before giving up. */
const LIST_TIMEOUT_MS = 5000;

export async function listModels(config: ProviderConfig): Promise<string[]> {
  const baseURL = resolveBaseURL(config);
  const headers: Record<string, string> = {};
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  // Bound the request so a hung/unreachable endpoint can't freeze /model list.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseURL}/models`, { headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(
        `Timed out after ${LIST_TIMEOUT_MS / 1000}s reaching ${baseURL}.`,
      );
    }
    throw new ProviderError(
      `Cannot reach ${baseURL}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new ProviderError(
      `Model list request failed (${res.status} ${res.statusText}).`,
    );
  }

  const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
}

/**
 * Resolve a {@link ProviderConfig} to an AI SDK {@link LanguageModel}.
 *
 * `structuredOutputs` opts the model into `response_format: {type:"json_schema"}`
 * for object generation. Local servers (LM Studio) reject both the default
 * object `tool_choice` and a bare `{type:"json_object"}`, accepting only
 * `json_schema` — so detection sets this; narration (plain tool-calling) does
 * not need it. See xyzzy.log.
 */
function createLanguageModel(
  config: ProviderConfig,
  opts: { structuredOutputs?: boolean } = {},
): LanguageModel {
  switch (config.kind) {
    case "openai-compatible":
    case "ollama": {
      const apiKey = config.apiKeyEnv
        ? process.env[config.apiKeyEnv]
        : undefined;
      const provider = createOpenAICompatible({
        name: config.kind,
        baseURL: resolveBaseURL(config),
        apiKey: apiKey ?? "not-needed",
      });
      return provider(config.model, undefined, {
        supportsStructuredOutputs: opts.structuredOutputs ?? false,
      });
    }
    case "openai":
    case "anthropic":
      throw new ProviderError(
        `Provider kind "${config.kind}" needs its cloud SDK package; ` +
          `use an "openai-compatible" endpoint for local models.`,
      );
  }
}

/** Map the stored transcript into AI SDK chat messages. */
function toModelMessages(transcript: Message[]): CoreMessage[] {
  return transcript.map((m) => ({
    role: m.role === "player" ? "user" : "assistant",
    content: m.text,
  }));
}

/**
 * Resolve a {@link ProviderConfig} to a concrete {@link NarratorModel}. The
 * model exposes the reducer actions as zod-typed tools and runs the AI SDK
 * multi-step tool loop, collecting validated action requests for the engine.
 */
export function createModel(config: ProviderConfig): NarratorModel {
  const languageModel = createLanguageModel(config);

  return {
    async generate(context: NarratorContext): Promise<NarratorResult> {
      const actions: Action[] = [];

      const tools = Object.fromEntries(
        NARRATION_TOOL_NAMES.map((name) => {
          const def = ACTION_TOOLS[name];
          return [
            name,
            tool({
              description: def.description,
              parameters: def.parameters,
              execute: async (args: unknown) => {
                const action = toAction(name, args);
                if (action) actions.push(action);
                return "ok";
              },
            }),
          ];
        }),
      );

      const result = await generateText({
        model: languageModel,
        maxSteps: MAX_STEPS,
        system: `${context.systemPrompt}\n\nCURRENT STATE:\n${context.digest}`,
        messages: [
          ...toModelMessages(context.transcript),
          { role: "user", content: context.input },
        ],
        tools,
      });

      return { narration: result.text, actions };
    },
  };
}

/** How long to wait for the detection call before aborting the turn's pre-pass. */
const DETECT_TIMEOUT_MS = 8000;

const DETECT_SYSTEM =
  "You extract structured intent from a text-adventure player's command. " +
  "Given the available exits (with destinations) and the active story beats " +
  "(with triggers), decide which exit the player is trying to take (or none) " +
  "and which beats' triggers the command now satisfies. Do not invent exits " +
  "or beats.";

/**
 * Resolve a {@link ProviderConfig} to a structured {@link Detector}: one
 * `generateObject` call per turn against the per-turn schema built from the
 * current exits and active beats, bounded by a timeout.
 */
export function createDetector(config: ProviderConfig): Detector {
  const languageModel = createLanguageModel(config, { structuredOutputs: true });
  return {
    async detect(ctx): Promise<Detection> {
      const schema = buildDetectionSchema(ctx.exits, ctx.activeBeats);
      const prompt = [
        `Player command: ${ctx.input}`,
        `Exits: ${
          ctx.exits.map((e) => `${e.direction} -> ${e.destination}`).join(", ") ||
          "(none)"
        }`,
        `Active beats: ${
          ctx.activeBeats.map((b) => `${b.id}: ${b.trigger}`).join(" | ") ||
          "(none)"
        }`,
      ].join("\n");

      const { object } = await generateObject({
        model: languageModel,
        schema,
        // Force JSON mode (response_format) rather than the SDK's default
        // "auto" -> tool mode, which sends an object `tool_choice` that local
        // servers like LM Studio reject with HTTP 400. See xyzzy.log.
        mode: "json",
        system: DETECT_SYSTEM,
        prompt,
        abortSignal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
      });
      // The schema already normalized "none" -> null and defaulted advancedBeats.
      return object;
    },
  };
}
