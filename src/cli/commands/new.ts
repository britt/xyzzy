import { createInterface } from "node:readline/promises";
import { basename, resolve } from "node:path";
import { scaffoldAdventure } from "../../world/scaffolder.js";

export interface Prompter {
  question(query: string): Promise<string>;
}

/**
 * Wrap readline's line iterator (rather than sequential `rl.question()`
 * calls) so piped/non-interactive stdin works: with piped input, all
 * buffered lines are emitted as soon as they arrive, so a second
 * `rl.question()` call attaches its listener too late and never sees the
 * line that already fired. Pulling lines one at a time from the iterator
 * avoids the race.
 */
function stdinPrompter(): Prompter & { close(): void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async question(query: string): Promise<string> {
      process.stdout.write(query);
      const { value, done } = await lines.next();
      return done ? "" : value;
    },
    close: () => rl.close(),
  };
}

/**
 * Scaffold a new adventure directory: `<name>` is the target directory.
 * Interactively prompts for the game's title (defaults to the directory
 * name) and an optional premise, then delegates to
 * {@link scaffoldAdventure}.
 */
export async function newAdventure(
  dir: string,
  prompter?: Prompter,
): Promise<void> {
  const owned = prompter ? undefined : stdinPrompter();
  const rl = prompter ?? owned!;
  try {
    const defaultTitle = basename(resolve(dir));
    const titleAnswer = (
      await rl.question(`Game title [${defaultTitle}]: `)
    ).trim();
    const title = titleAnswer || defaultTitle;

    const premiseAnswer = (
      await rl.question("Premise (optional — press Enter to skip): ")
    ).trim();

    await scaffoldAdventure({
      dir,
      title,
      premise: premiseAnswer || undefined,
    });
    console.log(`Scaffolded "${title}" in ${dir}`);
  } finally {
    owned?.close();
  }
}
