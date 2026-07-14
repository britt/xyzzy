import type { Adventure } from "./schema.js";
import { notImplemented } from "../util/notImplemented.js";

export interface ValidationIssue {
  /** dotted path to the offending value, e.g. `entities.rooms[2].exits.north` */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate a parsed (or raw) adventure: run the zod schema, then apply
 * cross-reference checks that exit targets, item/character locations, and start
 * ids resolve to real entities.
 *
 * TODO: schema parse → collect zod issues → cross-ref pass.
 */
export function validateAdventure(_adventure: unknown): ValidationResult {
  return notImplemented("world/validator.validateAdventure");
}

/** Cross-reference checks only; assumes the input already passed the schema. */
export function checkCrossReferences(_adventure: Adventure): ValidationIssue[] {
  return notImplemented("world/validator.checkCrossReferences");
}
