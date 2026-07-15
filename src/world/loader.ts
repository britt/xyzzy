import { readFileSync } from "node:fs";
import { statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { Adventure } from "./schema.js";
import { formatIssues, validateAdventure } from "./validator.js";

/** Thrown when an adventure cannot be read, parsed, or validated. */
export class AdventureLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdventureLoadError";
  }
}

/**
 * Resolve an adventure path to its `adventure.yaml` file. Accepts either the
 * adventure directory or the yaml file itself.
 */
export function resolveAdventureFile(path: string): string {
  try {
    if (statSync(path).isDirectory()) return join(path, "adventure.yaml");
  } catch {
    throw new AdventureLoadError(`No such adventure path: ${path}`);
  }
  return path;
}

/**
 * Read + parse the adventure YAML into a raw (unvalidated) object. Throws
 * {@link AdventureLoadError} on a missing file or YAML syntax error. The raw
 * value is what {@link validateAdventure} inspects to produce path-qualified
 * errors.
 */
export function readAdventureFile(path: string): unknown {
  const file = resolveAdventureFile(path);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new AdventureLoadError(`Cannot read adventure file: ${file}`);
  }
  try {
    return parseYaml(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdventureLoadError(`Invalid YAML in ${file}: ${detail}`);
  }
}

/**
 * Load, validate, and return a typed {@link Adventure}. Throws
 * {@link AdventureLoadError} with human-readable, path-qualified issues if the
 * adventure is invalid — callers such as `play` refuse to start on failure.
 */
export async function loadAdventure(path: string): Promise<Adventure> {
  const raw = readAdventureFile(path);
  const result = validateAdventure(raw);
  if (!result.ok) {
    throw new AdventureLoadError(
      `Invalid adventure (${resolveAdventureFile(path)}):\n${formatIssues(
        result.issues,
      )}`,
    );
  }
  // Safe: validateAdventure passed, so schema parse succeeds.
  return Adventure.parse(raw);
}
