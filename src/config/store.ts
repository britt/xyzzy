import type { GlobalConfig } from "./schema.js";
import { notImplemented } from "../util/notImplemented.js";

/** Absolute path to the global config file (`~/.config/xyzzy/config.json`). */
export function globalConfigPath(): string {
  return notImplemented("config/store.globalConfigPath");
}

/** Read + validate the global config, returning an empty config if absent. */
export async function readGlobalConfig(): Promise<GlobalConfig> {
  return notImplemented("config/store.readGlobalConfig");
}

/** Write the global config atomically. */
export async function writeGlobalConfig(_config: GlobalConfig): Promise<void> {
  return notImplemented("config/store.writeGlobalConfig");
}
