import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdventureConfig, type ProviderConfig } from "./schema.js";
import { readGlobalConfig } from "./store.js";

export interface ResolveOptions {
  /** value of the `--provider` flag, if any */
  providerFlag?: string;
  /** directory of the adventure being played (for `xyzzy.config.json`) */
  adventureDir?: string;
}

/** Zero-config default so `xyzzy play` works against a local Ollama server. */
export const DEFAULT_PROVIDER: ProviderConfig = {
  kind: "openai-compatible",
  baseURL: "http://localhost:11434/v1",
  model: "llama3.1",
};

export class ProviderResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderResolutionError";
  }
}

function readAdventureConfig(adventureDir: string): AdventureConfig {
  try {
    const text = readFileSync(join(adventureDir, "xyzzy.config.json"), "utf8");
    return AdventureConfig.parse(JSON.parse(text));
  } catch {
    return {};
  }
}

/**
 * Resolve the effective provider for a session. Precedence for the provider
 * name: `--provider` flag → adventure config → global default. If nothing is
 * configured, fall back to {@link DEFAULT_PROVIDER}. A per-adventure `model`
 * overrides the resolved provider's model.
 */
export async function resolveProvider(
  opts: ResolveOptions,
): Promise<ProviderConfig> {
  const global = await readGlobalConfig();
  const adventure = opts.adventureDir
    ? readAdventureConfig(opts.adventureDir)
    : {};

  const name = opts.providerFlag ?? adventure.provider ?? global.default;

  let provider: ProviderConfig;
  if (name !== undefined) {
    const found = global.providers[name];
    if (!found) {
      throw new ProviderResolutionError(
        `Unknown provider "${name}". Configure it with \`xyzzy config add\`.`,
      );
    }
    provider = found;
  } else {
    provider = DEFAULT_PROVIDER;
  }

  return adventure.model ? { ...provider, model: adventure.model } : provider;
}
