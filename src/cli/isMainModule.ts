import { pathToFileURL } from "node:url";

/**
 * `resolvedScriptPath` must already be realpath-resolved by the caller (npm's
 * global bin install is a symlink, and import.meta.url is realpath-resolved
 * by Node, so comparing against an unresolved process.argv[1] never matches).
 */
export function isMainModule(
  importMetaUrl: string,
  resolvedScriptPath: string,
): boolean {
  return importMetaUrl === pathToFileURL(resolvedScriptPath).href;
}
