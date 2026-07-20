import { readFileSync, readdirSync } from "node:fs";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
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
 * Entity kinds that may be split out of `adventure.yaml` into a sibling
 * directory named after the kind (`rooms/`, `items/`, `characters/`), by
 * convention. `beats/` follows the same convention outside `entities`.
 */
const ENTITY_KINDS = ["rooms", "items", "characters"] as const;

/** A raw (unvalidated) entity/beat value plus the file it came from, for
 * duplicate-id error messages. */
interface SourcedValue {
  value: unknown;
  file: string;
}

function isYamlFile(name: string): boolean {
  return name.endsWith(".yaml") || name.endsWith(".yml");
}

/**
 * Recursively list every `*.yaml`/`*.yml` file under `dir`, at any depth of
 * nesting, in deterministic (depth-first, alphabetical-per-level) order.
 * Returns `[]` if `dir` doesn't exist.
 */
function listYamlFilesRecursive(dir: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listYamlFilesRecursive(full));
    } else if (entry.isFile() && isYamlFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Read every `*.yaml`/`*.yml` file under `dir`, at any depth of nesting, and
 * flatten them into a list of raw values. Each file may contain a single
 * entity/beat object or an array of them. Returns `[]` if `dir` doesn't exist.
 */
function readConventionalDir(dir: string): SourcedValue[] {
  const out: SourcedValue[] = [];
  for (const file of listYamlFilesRecursive(dir)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new AdventureLoadError(`Cannot read file: ${file}`);
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new AdventureLoadError(`Invalid YAML in ${file}: ${detail}`);
    }
    if (parsed === null || parsed === undefined) continue;
    if (Array.isArray(parsed)) {
      for (const value of parsed) out.push({ value, file });
    } else {
      out.push({ value: parsed, file });
    }
  }
  return out;
}

/** Throw if two sourced values share an `id`, naming both files. */
function assertNoDuplicateIds(kind: string, entries: SourcedValue[]): void {
  const seenIn = new Map<string, string>();
  for (const { value, file } of entries) {
    if (typeof value !== "object" || value === null) continue;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== "string") continue;
    const prevFile = seenIn.get(id);
    if (prevFile) {
      throw new AdventureLoadError(
        `Duplicate ${kind} id "${id}" in ${file} (already defined in ${prevFile})`,
      );
    }
    seenIn.set(id, file);
  }
}

/**
 * Merge entities/beats found in conventional sibling directories (`rooms/`,
 * `items/`, `characters/`, `beats/`) into the raw adventure object parsed
 * from `adventure.yaml`. Directory-sourced entries are appended after any
 * inline `entities`/`beats` already present, so both styles can be mixed.
 * `dir` is the directory containing `adventure.yaml`.
 */
function mergeConventionalDirectories(raw: unknown, dir: string): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const adventure = raw as Record<string, unknown>;
  const adventureFile = join(dir, "adventure.yaml");

  const inlineEntities =
    typeof adventure.entities === "object" && adventure.entities !== null
      ? (adventure.entities as Record<string, unknown>)
      : {};

  const entities: Record<string, unknown> = { ...inlineEntities };
  for (const kind of ENTITY_KINDS) {
    const inline = Array.isArray(inlineEntities[kind])
      ? (inlineEntities[kind] as unknown[]).map(
          (value): SourcedValue => ({ value, file: adventureFile }),
        )
      : [];
    const fromDir = readConventionalDir(join(dir, kind));
    if (inline.length === 0 && fromDir.length === 0) continue;
    const combined = [...inline, ...fromDir];
    assertNoDuplicateIds(kind, combined);
    entities[kind] = combined.map((e) => e.value);
  }
  if (Object.keys(entities).length > 0) adventure.entities = entities;

  const inlineBeats = Array.isArray(adventure.beats)
    ? (adventure.beats as unknown[]).map(
        (value): SourcedValue => ({ value, file: adventureFile }),
      )
    : [];
  const beatsFromDir = readConventionalDir(join(dir, "beats"));
  if (inlineBeats.length > 0 || beatsFromDir.length > 0) {
    const combined = [...inlineBeats, ...beatsFromDir];
    assertNoDuplicateIds("beat", combined);
    adventure.beats = combined.map((e) => e.value);
  }

  return adventure;
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
 * Read + parse the adventure YAML into a raw (unvalidated) object, then merge
 * in any entities/beats found in conventional sibling directories (`rooms/`,
 * `items/`, `characters/`, `beats/`). Throws {@link AdventureLoadError} on a
 * missing file, a YAML syntax error, or a duplicate id across sources. The
 * raw value is what {@link validateAdventure} inspects to produce
 * path-qualified errors.
 */
export function readAdventureFile(path: string): unknown {
  const file = resolveAdventureFile(path);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new AdventureLoadError(`Cannot read adventure file: ${file}`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdventureLoadError(`Invalid YAML in ${file}: ${detail}`);
  }
  return mergeConventionalDirectories(raw, dirname(file));
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
