import { createElement } from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { loadAdventure, resolveAdventureFile } from "../../world/loader.js";
import { newGameState } from "../../engine/state.js";
import { loadGame, saveExists } from "../../engine/save.js";
import { resolveProvider } from "../../config/resolve.js";
import { createModel } from "../../llm/registry.js";
import { dirname } from "node:path";

export interface PlayOptions {
  save?: string;
  provider?: string;
}

const DEFAULT_SLOT = "autosave";

/**
 * Load the adventure + provider, seed or resume game state, and render the Ink
 * TUI. Refuses to start on an invalid adventure (loadAdventure throws).
 */
export async function play(path: string, opts: PlayOptions): Promise<void> {
  const adventure = await loadAdventure(path);
  const adventureDir = dirname(resolveAdventureFile(path));

  const provider = await resolveProvider({
    providerFlag: opts.provider,
    adventureDir,
  });
  const model = createModel(provider);

  const slot = opts.save ?? DEFAULT_SLOT;
  const state =
    opts.save && saveExists(adventureDir, slot)
      ? await loadGame(adventureDir, slot)
      : newGameState(adventure, new Date().toISOString());

  const { waitUntilExit } = render(
    createElement(App, {
      adventure,
      initialState: state,
      model,
      adventureDir,
      saveSlot: slot,
    }),
  );
  await waitUntilExit();
}
