import { notImplemented } from "../../util/notImplemented.js";

/**
 * Validate an adventure and print human-readable issues with paths. Resolves to
 * the process exit code (0 = valid, non-zero = invalid) so it works in CI.
 *
 * TODO: loadAdventure(raw) → validateAdventure → print issues → return code.
 */
export async function validate(_path: string): Promise<number> {
  return notImplemented("cli/commands/validate");
}
