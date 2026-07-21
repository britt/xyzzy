import { useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import type { Adventure, GameState } from "../world/schema.js";
import type { NarratorModel } from "../llm/NarratorModel.js";
import type { Detector } from "../llm/Detector.js";
import type { ProviderConfig } from "../config/schema.js";
import { runTurn, type TurnTiming } from "../engine/turnLoop.js";
import { loadGame, saveGame } from "../engine/save.js";
import { buildMap } from "../engine/asciiMap.js";
import { PromptInput } from "./PromptInput.js";
import { log, logPath, userMessage } from "../util/log.js";

export interface AppProps {
  adventure: Adventure;
  initialState: GameState;
  /** provider to start the session with (shown/edited by /model) */
  provider: ProviderConfig;
  /** builds the model from a provider; may throw if the provider is unbuildable */
  makeModel: (config: ProviderConfig) => NarratorModel;
  /**
   * builds the structured detector from a provider (may throw). Optional: when
   * omitted, turns run without a detection pre-pass (legacy narration-owned
   * movement).
   */
  makeDetector?: (config: ProviderConfig) => Detector;
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

/**
 * Build the detector without throwing, mirroring {@link buildModel}. The
 * detector is optional (no `makeDetector` → undefined) and best-effort: a build
 * failure leaves it undefined so `runTurn` degrades to legacy narration-owned
 * movement rather than crashing the TUI. Failures are logged, not surfaced —
 * detection is an internal refinement, not a user-facing capability like the
 * model.
 */
function buildDetector(
  make: ((config: ProviderConfig) => Detector) | undefined,
  config: ProviderConfig,
): Detector | undefined {
  if (!make) return undefined;
  try {
    return make(config);
  } catch (err) {
    log.warn("detector could not be initialized; running without detection", {
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

type Line = { key: number; role: "player" | "narrator" | "system"; text: string };

/** A completed turn's timing breakdown: `TurnTiming` plus the measured wall-clock total. */
type Timing = TurnTiming & { totalMs: number };

/** Render a millisecond duration as "1 second" (singular, whole seconds) or
 * "N.N seconds" (one decimal place) otherwise. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms) / 1000;
  const rounded = Math.round(seconds * 10) / 10;
  return rounded === 1 ? "1 second" : `${rounded.toFixed(1)} seconds`;
}

/** e.g. "Turn 2.5 seconds (detector - 1 second, narrator - 1.5 seconds)". */
export function formatTimingLine(timing: Timing): string {
  const parts = [`narrator - ${formatDuration(timing.narratorMs)}`];
  if (timing.detectorCalls > 0) {
    parts.unshift(`detector - ${formatDuration(timing.detectorMs ?? 0)}`);
  }
  return `Turn ${formatDuration(timing.totalMs)} (${parts.join(", ")})`;
}

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
  "/map                draw an ASCII map of rooms, connections, and who's where",
  "/state              dump the current game state (transcript elided)",
  "/transcript         print the full conversation transcript",
  "/log                show the log file path",
  "/timing [on|off]    toggle turn/LLM-call timing display",
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
  makeDetector,
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
  // Built lazily beside the model (same error-tolerance): an unbuildable
  // detector is undefined, and runTurn degrades to legacy movement.
  const [detector, setDetector] = useState(() =>
    buildDetector(makeDetector, initialProvider),
  );
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Command history for the input line (bash-style Up/Down recall lives in
  // PromptInput; this is just the recorded list).
  const [history, setHistory] = useState<string[]>([]);
  const [timingEnabled, setTimingEnabled] = useState(false);
  const [lastTiming, setLastTiming] = useState<Timing | null>(null);

  function push(role: Line["role"], text: string) {
    setLines((prev) => [...prev, { key: prev.length, role, text }]);
  }

  /** Adopt a new provider config for the session, rebuilding the model. Never
   * throws — an unbuildable model is reported but keeps the session alive. */
  function applyProvider(next: ProviderConfig, okMsg: string) {
    const built = buildModel(makeModel, next);
    setProvider(next);
    setModelState({ model: built.model, modelError: built.error });
    setDetector(buildDetector(makeDetector, next));
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
      case "/map":
        push("system", buildMap(adventure, state));
        return true;
      case "/state":
        // Elide the (potentially huge) transcript; use /transcript to see it.
        push(
          "system",
          JSON.stringify(
            state,
            (key, value) => (key === "transcript" ? "[ ... ]" : value),
            2,
          ),
        );
        return true;
      case "/transcript":
        push(
          "system",
          state.transcript.length === 0
            ? "(transcript is empty)"
            : state.transcript
                .map((m) => `[${m.turn}] ${m.role}: ${m.text}`)
                .join("\n"),
        );
        return true;
      case "/log":
        push("system", `Log file: ${logPath()}`);
        return true;
      case "/timing": {
        const next = arg === "on" ? true : arg === "off" ? false : !timingEnabled;
        setTimingEnabled(next);
        push("system", `Timing display ${next ? "on" : "off"}.`);
        return true;
      }
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
    if (value === "" || busy) return;
    setError(null);

    // Record in history (skip consecutive duplicates, like bash).
    setHistory((h) => (h[h.length - 1] === value ? h : [...h, value]));

    if (value.startsWith("/")) {
      const [command, ...rest] = value.split(/\s+/);
      try {
        const handled = await handleMeta(command ?? "", rest.join(" "));
        if (!handled) push("system", `Unknown command: ${command}`);
      } catch (err) {
        log.error(`meta command failed: ${value}`, err);
        setError(userMessage(err));
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
    const turnStart = Date.now();
    const attemptedTurn = state.turn + 1;
    try {
      const result = await runTurn({ adventure, model, detector }, state, value);
      const totalMs = Date.now() - turnStart;
      setState(result.state);
      setLastTiming({ ...result.timing, totalMs });
      log.info("turn timing", {
        turn: attemptedTurn,
        totalMs,
        ...result.timing,
        ok: true,
      });
      push("narrator", result.narration);
      await saveGame(adventureDir, saveSlot, result.state);
    } catch (err) {
      // Turn rolled back: state is unchanged. Log full provider detail
      // (statusCode, responseBody, cause) to disk; show a concise line here.
      log.info("turn timing", {
        turn: attemptedTurn,
        totalMs: Date.now() - turnStart,
        ok: false,
      });
      log.error(`turn failed: ${value}`, err);
      setError(`${userMessage(err)} · details in ${logPath()}`);
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

      {timingEnabled && lastTiming && (
        <Box>
          <Text dimColor>{formatTimingLine(lastTiming)}</Text>
        </Box>
      )}

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
          <PromptInput history={history} onSubmit={submit} />
        </Box>
      )}
    </Box>
  );
}
