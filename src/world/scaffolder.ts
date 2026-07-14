import { notImplemented } from "../util/notImplemented.js";

export interface ScaffoldOptions {
  /** target directory; refuses to overwrite an existing non-empty dir */
  dir: string;
  name: string;
}

/**
 * Write a minimal valid adventure: `adventure.yaml`, a `saves/` dir, a README,
 * and commented example room + character. Refuses to overwrite.
 *
 * TODO: mkdir, render templates, guard against existing files.
 */
export async function scaffoldAdventure(_opts: ScaffoldOptions): Promise<void> {
  return notImplemented("world/scaffolder.scaffoldAdventure");
}
