import { notImplemented } from "../../util/notImplemented.js";

export interface PlayOptions {
  save?: string;
  provider?: string;
}

/**
 * Load the adventure + provider, seed or resume game state, render the Ink TUI.
 *
 * TODO: loadAdventure → resolveProvider → createModel → newGameState/loadGame →
 * render(<App/>).
 */
export async function play(_path: string, _opts: PlayOptions): Promise<void> {
  return notImplemented("cli/commands/play");
}
