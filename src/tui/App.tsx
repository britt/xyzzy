import { Box, Text } from "ink";
import type { Adventure, GameState } from "../world/schema.js";
import type { NarratorModel } from "../llm/NarratorModel.js";

export interface AppProps {
  adventure: Adventure;
  initialState: GameState;
  model: NarratorModel;
}

/**
 * Ink play screen: a status bar, scrollback (narration + echoed input), an
 * input line, and a spinner while the model runs. A thin view over engine
 * state — driven by `runTurn`, testable with a fake model via
 * `ink-testing-library`.
 *
 * TODO: scrollback state, ink-text-input line, spinner during turns, meta
 * command interception (/save /load /state /help /quit), autosave.
 */
export function App({ adventure }: AppProps) {
  return (
    <Box flexDirection="column">
      <Text>
        {adventure.meta.title} — xyzzy (TUI not yet implemented)
      </Text>
    </Box>
  );
}
