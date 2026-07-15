import {
  AdventureLoadError,
  readAdventureFile,
  resolveAdventureFile,
} from "../../world/loader.js";
import { formatIssues, validateAdventure } from "../../world/validator.js";

/**
 * Validate an adventure and print human-readable issues with paths. Resolves to
 * the process exit code (0 = valid, non-zero = invalid) so it works in CI.
 */
export async function validate(path: string): Promise<number> {
  const file = resolveAdventureFile(path);

  let raw: unknown;
  try {
    raw = readAdventureFile(path);
  } catch (err) {
    if (err instanceof AdventureLoadError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  const result = validateAdventure(raw);
  if (result.ok) {
    console.log(`✓ ${file} is valid`);
    return 0;
  }

  console.error(`✗ ${file} has ${result.issues.length} issue(s):`);
  console.error(formatIssues(result.issues));
  return 1;
}
