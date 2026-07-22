import { realpathSync } from "node:fs";

/**
 * Resolves symlinks like `realpathSync`, but returns undefined instead of
 * throwing (e.g. a dangling npm global `bin` symlink) so the entry-point
 * self-invocation check can fail closed rather than crash on module load.
 */
export function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
