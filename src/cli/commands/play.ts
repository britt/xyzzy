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
import { startSessionLog } from "../../llm/sessionLog.js";
import { dirname } from "node:path";

export interface PlayOptions {
  save?: string;
  provider?: string;
  /** record every detector/narrator call to a session log file */
  logLlm?: boolean;
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
  const resumedFrom =
    opts.save && saveExists(adventure.meta.id, slot) ? slot : null;
  const state =
    resumedFrom !== null
      ? await loadGame(adventure.meta.id, resumedFrom)
      : newGameState(adventure, new Date().toISOString());

  // Opt-in for `play`: recording is a debugging aid, not something a player
  // should pay for by default. `dev` always records.
  const sessionLog = opts.logLlm
    ? startSessionLog({
        adventureId: adventure.meta.id,
        source: "play",
        provider: {
          kind: provider.kind,
          baseURL: provider.baseURL,
          model: provider.model,
        },
        saveSlot: slot,
        resumedFrom,
      })
    : undefined;

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
      saveSlot: slot,
      sessionLog,
    }),
  );
  await waitUntilExit();

  // The TUI has unmounted (e.g. via /quit). Exit promptly rather than waiting
  // for lingering handles — an HTTP keep-alive socket from a model call can
  // otherwise keep the event loop alive for seconds after the player quits.
  process.exit(0);
}
