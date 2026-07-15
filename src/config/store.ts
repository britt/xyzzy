import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GlobalConfig } from "./schema.js";

/** Absolute path to the global config file (`$XDG_CONFIG_HOME/xyzzy/config.json`
 * or `~/.config/xyzzy/config.json`). */
export function globalConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "xyzzy", "config.json");
}

/** Read + validate the global config, returning an empty config if absent. */
export async function readGlobalConfig(): Promise<GlobalConfig> {
  let text: string;
  try {
    text = readFileSync(globalConfigPath(), "utf8");
  } catch {
    return GlobalConfig.parse({});
  }
  return GlobalConfig.parse(JSON.parse(text));
}

/** Write the global config atomically (temp file + rename). */
export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const path = globalConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(GlobalConfig.parse(config), null, 2), "utf8");
  renameSync(tmp, path);
}
