import type { ProviderConfig } from "./schema.js";
import { notImplemented } from "../util/notImplemented.js";

export interface ResolveOptions {
  /** value of the `--provider` flag, if any */
  providerFlag?: string;
  /** directory of the adventure being played (for `xyzzy.config.json`) */
  adventureDir?: string;
}

/**
 * Resolve the effective provider config for a session. Precedence:
 * `--provider` flag → adventure config → global default.
 *
 * TODO: read global + adventure config, apply precedence, throw if unresolved.
 */
export async function resolveProvider(
  _opts: ResolveOptions,
): Promise<ProviderConfig> {
  return notImplemented("config/resolve.resolveProvider");
}
