import { notImplemented } from "../../util/notImplemented.js";

/** Scaffold a new adventure directory. Delegates to `world/scaffolder`. */
export async function newAdventure(_name: string): Promise<void> {
  return notImplemented("cli/commands/new");
}
