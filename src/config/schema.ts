import { z } from "zod";

/**
 * Provider + global config schemas. Global config lives at
 * `~/.config/xyzzy/config.json`; an adventure may override with its own
 * `xyzzy.config.json`. Secrets (cloud keys) are read from env, never stored.
 */

export const ProviderKind = z.enum([
  "openai-compatible",
  "lmstudio",
  "ollama",
  "openai",
  "anthropic",
]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const ProviderConfig = z.object({
  kind: ProviderKind,
  /** base URL for local / openai-compatible servers */
  baseURL: z.string().url().optional(),
  /** model id, e.g. `llama3.1` */
  model: z.string().min(1),
  /** env var name to read an API key from (never the key itself) */
  apiKeyEnv: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const GlobalConfig = z.object({
  /** named provider map */
  providers: z.record(z.string(), ProviderConfig).default({}),
  /** name of the default provider in `providers` */
  default: z.string().optional(),
});
export type GlobalConfig = z.infer<typeof GlobalConfig>;

/** Per-adventure override file (`xyzzy.config.json`). */
export const AdventureConfig = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
});
export type AdventureConfig = z.infer<typeof AdventureConfig>;
