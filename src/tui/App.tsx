import { useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import type { Adventure, GameState } from "../world/schema.js";
import type { NarratorModel } from "../llm/NarratorModel.js";
import type { ProviderConfig } from "../config/schema.js";
import { runTurn } from "../engine/turnLoop.js";
import { loadGame, saveGame } from "../engine/save.js";

export interface AppProps {
  adventure: Adventure;
  initialState: GameState;
  /** provider to start the session with (shown/edited by /model) */
  provider: ProviderConfig;
  /** builds the model from a provider; may throw if the provider is unbuildable */
  makeModel: (config: ProviderConfig) => NarratorModel;
  /** lists model ids offered by the provider endpoint (for /model list) */
  listModels: (config: ProviderConfig) => Promise<string[]>;
  /** named providers from global config (for /provider list|use) */
  providers: Record<string, ProviderConfig>;
  /** directory the adventure lives in (for saves) */
  adventureDir: string;
  /** autosave slot */
  saveSlot: string;
}

/**
 * Build a model without throwing. A failure (bad provider kind, missing SDK,
 * etc.) must not stop the TUI from starting — slash commands always work; only
 * taking a turn needs a live model.
 */
function buildModel(
  make: (config: ProviderConfig) => NarratorModel,
  config: ProviderConfig,
): { model: NarratorModel | null; error: string | null } {
  try {
    return { model: make(config), error: null };
  } catch (err) {
    return { model: null, error: err instanceof Error ? err.message : String(err) };
  }
}

type Line = { key: number; role: "player" | "narrator" | "system"; text: string };

/** One-line, human-readable summary of a provider config. */
function describeProvider(config: ProviderConfig): string {
  const key = config.apiKeyEnv ? ` · key $${config.apiKeyEnv}` : "";
  return `${config.kind} · ${config.baseURL ?? "(default endpoint)"} · model "${config.model}"${key}`;
}

const HELP = [
  "/save [slot]        save the game (defaults to the autosave slot)",
  "/load [slot]        load a saved game",
  "/model [id]         show the current LLM, or switch to model <id>",
  "/model list         list models offered by the endpoint",
  "/provider           show the current provider",
  "/provider list      list configured providers",
  "/provider use <n>   switch to a configured provider",
  "/provider url <u>   point the provider at a different endpoint",
  "/state              dump the current game state",
  "/help               show this help",
  "/quit               exit",
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
  provider: initialProvider,
  makeModel,
  listModels,
  providers,
  adventureDir,
  saveSlot,
}: AppProps) {
  const { exit } = useApp();
  const [state, setState] = useState(initialState);
  const [provider, setProvider] = useState(initialProvider);
  const [{ model, modelError }, setModelState] = useState(() => {
    const built = buildModel(makeModel, initialProvider);
    return { model: built.model, modelError: built.error };
  });
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

  /** Adopt a new provider config for the session, rebuilding the model. Never
   * throws — an unbuildable model is reported but keeps the session alive. */
  function applyProvider(next: ProviderConfig, okMsg: string) {
    const built = buildModel(makeModel, next);
    setProvider(next);
    setModelState({ model: built.model, modelError: built.error });
    push(
      "system",
      built.error
        ? `${okMsg} (but the model could not be initialized: ${built.error})`
        : okMsg,
    );
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
      case "/model": {
        if (!arg) {
          push("system", `LLM: ${describeProvider(provider)}`);
          return true;
        }
        if (arg === "list") {
          try {
            const models = await listModels(provider);
            push(
              "system",
              models.length
                ? "Available models:\n" +
                    models
                      .map((m) => (m === provider.model ? `  * ${m}` : `    ${m}`))
                      .join("\n")
                : "The endpoint reported no models.",
            );
          } catch (err) {
            // Listing needs the endpoint; when it's down, respond calmly with
            // what we know and how to fix it rather than an error banner.
            const detail = err instanceof Error ? err.message : String(err);
            push(
              "system",
              `Couldn't list models — ${detail}\n` +
                `Current model: "${provider.model}" · ${provider.baseURL ?? "(default endpoint)"}\n` +
                "Start a local server (e.g. `ollama serve`) or switch with /model <id>.",
            );
          }
          return true;
        }
        applyProvider({ ...provider, model: arg }, `Model switched to "${arg}".`);
        return true;
      }
      case "/provider": {
        const [sub = "", ...restArgs] = arg.split(/\s+/).filter(Boolean);
        const rest = restArgs.join(" ");

        if (sub === "") {
          push("system", `Provider: ${describeProvider(provider)}`);
          return true;
        }
        if (sub === "list") {
          const names = Object.keys(providers);
          const listing = names.length
            ? "Configured providers:\n" +
              names
                .map((n) => `    ${n} — ${describeProvider(providers[n]!)}`)
                .join("\n")
            : "No named providers configured. Add some with `xyzzy config`.";
          push("system", `${listing}\nCurrent: ${describeProvider(provider)}`);
          return true;
        }
        if (sub === "use") {
          if (!rest) {
            push("system", "Usage: /provider use <name>");
            return true;
          }
          const target = providers[rest];
          if (!target) {
            const known = Object.keys(providers).join(", ") || "(none)";
            push("system", `Unknown provider "${rest}". Configured: ${known}.`);
            return true;
          }
          applyProvider(target, `Switched to provider "${rest}".`);
          return true;
        }
        if (sub === "url") {
          if (!rest) {
            push("system", "Usage: /provider url <baseURL>");
            return true;
          }
          applyProvider({ ...provider, baseURL: rest }, `Endpoint set to ${rest}.`);
          return true;
        }
        push(
          "system",
          `Unknown /provider subcommand "${sub}". Try: /provider, /provider list, /provider use <name>, /provider url <baseURL>.`,
        );
        return true;
      }
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

    if (!model) {
      push("player", `> ${value}`);
      setError(
        modelError ??
          "No language model is available. Use /model to configure or switch one.",
      );
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
