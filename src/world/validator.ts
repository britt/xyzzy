import type { ZodIssue } from "zod";
import { Adventure } from "./schema.js";

export interface ValidationIssue {
  /** dotted path to the offending value, e.g. `entities.rooms[2].exits.north` */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Render a zod issue path (`["entities","rooms",2,"exits","north"]`) as a
 * dotted string with array indices in brackets. */
function formatZodPath(path: ZodIssue["path"]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? segment : `.${segment}`;
  }
  return out === "" ? "(root)" : out;
}

/**
 * Validate a raw (parsed-from-YAML) value: run the {@link Adventure} schema,
 * then — if the shape is valid — apply cross-reference checks that exits,
 * item/character locations, and start ids resolve to real entities.
 */
export function validateAdventure(raw: unknown): ValidationResult {
  const parsed = Adventure.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: formatZodPath(issue.path),
        message: issue.message,
      })),
    };
  }
  const issues = checkCrossReferences(parsed.data);
  return { ok: issues.length === 0, issues };
}

/**
 * Cross-reference checks over a schema-valid adventure: every exit target,
 * item/character location, and start reference must resolve to a real id.
 */
export function checkCrossReferences(
  adventure: Adventure,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rooms = adventure.entities?.rooms ?? [];
  const items = adventure.entities?.items ?? [];
  const characters = adventure.entities?.characters ?? [];

  const roomIds = new Set(rooms.map((r) => r.id));
  const itemIds = new Set(items.map((i) => i.id));
  const charIds = new Set(characters.map((c) => c.id));

  rooms.forEach((room, ri) => {
    for (const [dir, target] of Object.entries(room.exits ?? {})) {
      if (!roomIds.has(target)) {
        issues.push({
          path: `entities.rooms[${ri}].exits.${dir}`,
          message: `unknown room "${target}"`,
        });
      }
    }
  });

  // An item's location may be a room (it lies there) or a character (held).
  items.forEach((item, ii) => {
    if (
      item.location !== undefined &&
      !roomIds.has(item.location) &&
      !charIds.has(item.location)
    ) {
      issues.push({
        path: `entities.items[${ii}].location`,
        message: `unknown room or character "${item.location}"`,
      });
    }
  });

  characters.forEach((char, ci) => {
    if (char.location !== undefined && !roomIds.has(char.location)) {
      issues.push({
        path: `entities.characters[${ci}].location`,
        message: `unknown room "${char.location}"`,
      });
    }

    const beatIds = new Set<string>();
    (char.beats ?? []).forEach((beat, bi) => {
      if (beatIds.has(beat.id)) {
        issues.push({
          path: `entities.characters[${ci}].beats[${bi}].id`,
          message: `duplicate beat id "${beat.id}"`,
        });
      }
      beatIds.add(beat.id);
    });

    const interactionIds = new Set<string>();
    (char.interactions ?? []).forEach((interaction, ii) => {
      if (interactionIds.has(interaction.id)) {
        issues.push({
          path: `entities.characters[${ci}].interactions[${ii}].id`,
          message: `duplicate interaction id "${interaction.id}"`,
        });
      }
      interactionIds.add(interaction.id);
    });
  });

  if (adventure.start.room !== undefined && !roomIds.has(adventure.start.room)) {
    issues.push({
      path: `start.room`,
      message: `unknown room "${adventure.start.room}"`,
    });
  }

  (adventure.start.inventory ?? []).forEach((id, ii) => {
    if (!itemIds.has(id)) {
      issues.push({
        path: `start.inventory[${ii}]`,
        message: `unknown item "${id}"`,
      });
    }
  });

  return issues;
}

/** Render issues as human-readable `path → message` lines. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `  ${i.path} → ${i.message}`).join("\n");
}
