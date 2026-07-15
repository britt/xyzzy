import { useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { Adventure, GameState } from "../world/schema.js";
import type { NarratorModel } from "../llm/NarratorModel.js";
import { runTurn } from "../engine/turnLoop.js";
import { loadGame, saveGame } from "../engine/save.js";

export interface AppProps {
  adventure: Adventure;
  initialState: GameState;
  model: NarratorModel;
  /** directory the adventure lives in (for saves) */
  adventureDir: string;
  /** autosave slot */
  saveSlot: string;
}

type Line = { key: number; role: "player" | "narrator" | "system"; text: string };

const HELP = [
  "/save [slot]  save the game (defaults to the autosave slot)",
  "/load [slot]  load a saved game",
  "/state        dump the current game state",
  "/help         show this help",
  "/quit         exit",
].join("\n");

function roomName(adventure: Adventure, state: GameState): string {
  if (state.location === null) return "—";
  const room = adventure.entities?.rooms?.find((r) => r.id === state.location);
  return room?.name ?? state.location;
}

/**
 * Ink play screen: a thin view over engine state. A status bar, scrollback
 * (narration + echoed input), an input line, and a spinner while the model
 * runs. Meta commands are intercepted before the model. Driven by `runTurn`;
 * testable with a fake model via `ink-testing-library`.
 */
export function App({
  adventure,
  initialState,
  model,
  adventureDir,
  saveSlot,
}: AppProps) {
  const { exit } = useApp();
  const [state, setState] = useState(initialState);
  const [lines, setLines] = useState<Line[]>(() => {
    const room = adventure.entities?.rooms?.find(
      (r) => r.id === initialState.location,
    );
    return [
      {
        key: 0,
        role: "narrator",
        text: (room?.description ?? adventure.premise).trim(),
      },
    ];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function push(role: Line["role"], text: string) {
    setLines((prev) => [...prev, { key: prev.length, role, text }]);
  }

  async function handleMeta(command: string, arg: string): Promise<boolean> {
    switch (command) {
      case "/quit":
        exit();
        return true;
      case "/help":
        push("system", HELP);
        return true;
      case "/state":
        push("system", JSON.stringify(state, null, 2));
        return true;
      case "/save":
        await saveGame(adventureDir, arg || saveSlot, state);
        push("system", `Saved to slot "${arg || saveSlot}".`);
        return true;
      case "/load": {
        const loaded = await loadGame(adventureDir, arg || saveSlot);
        setState(loaded);
        push("system", `Loaded slot "${arg || saveSlot}".`);
        return true;
      }
      default:
        return false;
    }
  }

  async function submit(raw: string) {
    const value = raw.trim();
    setInput("");
    if (value === "" || busy) return;
    setError(null);

    if (value.startsWith("/")) {
      const [command, ...rest] = value.split(/\s+/);
      try {
        const handled = await handleMeta(command ?? "", rest.join(" "));
        if (!handled) push("system", `Unknown command: ${command}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    push("player", `> ${value}`);
    setBusy(true);
    try {
      const result = await runTurn({ adventure, model }, state, value);
      setState(result.state);
      push("narrator", result.narration);
      await saveGame(adventureDir, saveSlot, result.state);
    } catch (err) {
      // Turn rolled back: state is unchanged, surface a non-fatal error line.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column">
      <Static items={lines}>
        {(line) => (
          <Box key={line.key} marginBottom={1}>
            <Text
              color={
                line.role === "player"
                  ? "cyan"
                  : line.role === "system"
                    ? "yellow"
                    : undefined
              }
              dimColor={line.role === "system"}
            >
              {line.text}
            </Text>
          </Box>
        )}
      </Static>

      <Box>
        <Text dimColor>
          {adventure.meta.title} · {roomName(adventure, state)} · turn{" "}
          {state.turn}
        </Text>
      </Box>

      {error && (
        <Box>
          <Text color="red">! {error}</Text>
        </Box>
      )}

      {busy ? (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> thinking…</Text>
        </Box>
      ) : (
        <Box>
          <Text>{"> "}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
        </Box>
      )}
    </Box>
  );
}
