import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Resolves the package root's `package.json` from this module's own URL.
 * Works unchanged in both dev (`src/cli/index.ts`) and the built package
 * (`dist/cli/index.js`), since `--root ./src --outdir ./dist` preserves the
 * same `<kind>/cli/index.*` depth under the package root in both cases.
 */
export function resolvePackageJsonPath(importMetaUrl: string): string {
  const moduleDir = dirname(fileURLToPath(importMetaUrl));
  return join(moduleDir, "..", "..", "package.json");
}
