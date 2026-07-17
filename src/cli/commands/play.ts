import { createElement } from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { loadAdventure, resolveAdventureFile } from "../../world/loader.js";
import { newGameState } from "../../engine/state.js";
import { loadGame, saveExists } from "../../engine/save.js";
import { resolveProvider } from "../../config/resolve.js";
import { readGlobalConfig } from "../../config/store.js";
import { createDetector, createModel, listModels } from "../../llm/registry.js";
import { log } from "../../util/log.js";
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
  const providers = (await readGlobalConfig()).providers;

  const slot = opts.save ?? DEFAULT_SLOT;
  const state =
    opts.save && saveExists(adventureDir, slot)
      ? await loadGame(adventureDir, slot)
      : newGameState(adventure, new Date().toISOString());

  log.info("play started", {
    adventure: adventure.meta.id,
    provider: { kind: provider.kind, baseURL: provider.baseURL, model: provider.model },
    slot,
  });

  const { waitUntilExit } = render(
    createElement(App, {
      adventure,
      initialState: state,
      provider,
      // Built lazily inside the TUI so an unbuildable/unreachable LLM never
      // blocks startup — slash commands (incl. /model, /quit) always work.
      makeModel: createModel,
      makeDetector: createDetector,
      listModels,
      providers,
      adventureDir,
      saveSlot: slot,
    }),
  );
  await waitUntilExit();

  // The TUI has unmounted (e.g. via /quit). Exit promptly rather than waiting
  // for lingering handles — an HTTP keep-alive socket from a model call can
  // otherwise keep the event loop alive for seconds after the player quits.
  process.exit(0);
}
