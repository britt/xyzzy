/** Lowercase; collapse runs of non-alphanumeric characters to a single `-`; trim leading/trailing `-`. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
