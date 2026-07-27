import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { render } from "ink";
import { DevApp } from "../../tui/DevApp.js";
import { loadAdventure, resolveAdventureFile } from "../../world/loader.js";
import { resolveProvider } from "../../config/resolve.js";
import { readGlobalConfig } from "../../config/store.js";
import { createDetector, createModel, listModels } from "../../llm/registry.js";
import { log } from "../../util/log.js";

export interface DevOptions {
  provider?: string;
}

/**
 * Run $EDITOR (or $VISUAL, or vi) on `path` against the real TTY, returning
 * once it exits. `stdio: "inherit"` hands the terminal to the editor for the
 * duration; Ink repaints on the next render.
 */
function defaultOpenEditor(path: string): void {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
  spawnSync(editor, [path], { stdio: "inherit" });
}

/**
 * Load the adventure + provider and render the multi-pane development TUI.
 * Refuses to start on an invalid adventure (loadAdventure throws), the same as
 * `play` — once running, per-entity validation failures are shown inline
 * instead of being fatal.
 */
export async function dev(path: string, opts: DevOptions): Promise<void> {
  const adventure = await loadAdventure(path);
  const adventureDir = dirname(resolveAdventureFile(path));

  const provider = await resolveProvider({
    providerFlag: opts.provider,
    adventureDir,
  });
  const providers = (await readGlobalConfig()).providers;

  log.info("dev started", {
    adventure: adventure.meta.id,
    provider: { kind: provider.kind, baseURL: provider.baseURL, model: provider.model },
  });

  const { waitUntilExit } = render(
    createElement(DevApp, {
      adventure,
      adventureDir,
      openEditor: defaultOpenEditor,
      provider,
      // Built lazily inside the TUI so an unreachable LLM never blocks
      // startup — browsing and editing don't need a model at all.
      makeModel: createModel,
      makeDetector: createDetector,
      listModels,
      providers,
    }),
  );
  await waitUntilExit();

  // Mirror `play`: exit promptly rather than waiting on lingering handles (an
  // HTTP keep-alive socket from a model call can otherwise hold the loop open).
  process.exit(0);
}
