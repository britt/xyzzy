import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, tool, type CoreMessage, type LanguageModel } from "ai";
import type { Action } from "../world/actions.js";
import type { ProviderConfig } from "../config/schema.js";
import type { Message } from "../world/schema.js";
import {
  type NarratorContext,
  type NarratorModel,
  type NarratorResult,
} from "./NarratorModel.js";
import { ACTION_TOOLS, toAction } from "./tools.js";

/** Max tool-loop steps per turn (model may narrate + emit several mutations). */
const MAX_STEPS = 6;

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Resolve a {@link ProviderConfig} to an AI SDK {@link LanguageModel}. */
function createLanguageModel(config: ProviderConfig): LanguageModel {
  switch (config.kind) {
    case "openai-compatible":
    case "ollama": {
      const apiKey = config.apiKeyEnv
        ? process.env[config.apiKeyEnv]
        : undefined;
      const provider = createOpenAICompatible({
        name: config.kind,
        baseURL: config.baseURL ?? "http://localhost:11434/v1",
        apiKey: apiKey ?? "not-needed",
      });
      return provider(config.model);
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
        Object.entries(ACTION_TOOLS).map(([name, def]) => [
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
        ]),
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
