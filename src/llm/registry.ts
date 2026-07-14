import type { ProviderConfig } from "../config/schema.js";
import type { NarratorModel } from "./NarratorModel.js";
import { notImplemented } from "../util/notImplemented.js";

/**
 * Resolve a {@link ProviderConfig} to a concrete {@link NarratorModel} backed
 * by an AI SDK `LanguageModel`.
 *
 * TODO:
 *   openai-compatible → createOpenAICompatible({ baseURL, apiKey? })  (default)
 *   ollama            → community provider
 *   openai | anthropic→ cloud escape hatch (keys from env)
 * then wrap the LanguageModel in a NarratorModel that runs generateText with
 * the action tools.
 */
export function createModel(_config: ProviderConfig): NarratorModel {
  return notImplemented("llm/registry.createModel");
}
