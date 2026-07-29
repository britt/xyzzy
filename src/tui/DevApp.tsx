import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import {
  Adventure as AdventureSchema,
  type Adventure,
  type Character,
  type GameState,
  type Item,
  type Room,
  type StoryBeat,
} from "../world/schema.js";
import { App } from "./App.js";
import type { NarratorModel } from "../llm/NarratorModel.js";
import type { Detector } from "../llm/Detector.js";
import type { ProviderConfig } from "../config/schema.js";
import { listSaves, loadGame } from "../engine/save.js";
import { newGameState } from "../engine/state.js";
import {
  readAdventureFileWithSources,
  resolveAdventureFile,
  type EntitySourceMap,
} from "../world/loader.js";
import {
  formatIssues,
  validateAdventure,
  type ValidationIssue,
} from "../world/validator.js";
import { entityFilePath, type EntityKind } from "../world/entityWriter.js";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  entriesForCategory,
  type CatalogEntry,
  type Category,
} from "./dev/entityCatalog.js";
import {
  renderConfigFields,
  renderFieldsFor,
  type FieldRow,
} from "./dev/renderFields.js";
import {
  contentPaneHeight,
  contentPaneWidth,
  devLayout,
  playViewport,
} from "./dev/layout.js";
import { fitHotKeys, hotKeysFor } from "./dev/hotkeys.js";
import {
  listSessionLogs,
  readSessionLog,
  startSessionLog,
  type SessionLogHandle,
  type SessionLogListing,
} from "../llm/sessionLog.js";
import { renderSessionLogFields } from "./dev/renderSessionLog.js";
import {
  clampScroll,
  layoutFieldRows,
  type DisplayLine,
  type LineStyle,
} from "./dev/contentLines.js";

export interface DevAppProps {
  adventure: Adventure;
  adventureDir: string;
  /** injected for testability; defaults to a real $EDITOR spawn in dev.ts. */
  openEditor?: (path: string) => void;
  /**
   * Provider + factories for the embedded play session, mirroring `AppProps`.
   * Optional so browsing-only callers (and the browsing tests) need not supply
   * them; without them `p` has nothing to mount.
   */
  provider?: ProviderConfig;
  makeModel?: (config: ProviderConfig) => NarratorModel;
  makeDetector?: (config: ProviderConfig) => Detector;
  listModels?: (config: ProviderConfig) => Promise<string[]>;
  providers?: Record<string, ProviderConfig>;
  saveSlot?: string;
}

/** Which pane owns the keyboard. */
type Focus = "sidebar" | "play";

type SelectionByCategory = Record<Category, number>;

/** Issue-map key for the adventure's own config, which has no (kind, id). */
const CONFIG_KEY = "config";

function entityKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Read where each entity is defined, tolerating an unreadable adventure (the
 * caller has already loaded it once; a failure here only costs us the ability
 * to resolve edit targets precisely, and `sourceFile` falls back).
 */
function readSourcesSafely(adventureDir: string): EntitySourceMap {
  try {
    return readAdventureFileWithSources(adventureDir).sources;
  } catch {
    return new Map();
  }
}

/**
 * Track the terminal's size, following resizes. Both dimensions may be
 * undefined when stdout isn't a TTY (or under a test stdout), in which case
 * the screen falls back to sizing itself to its content.
 */
function useTerminalSize(): { columns?: number; rows?: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns,
    rows: stdout?.rows,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () =>
      setSize({ columns: stdout.columns, rows: stdout.rows });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}

/**
 * Colour carries meaning rather than decoration: cyan for the entity you're
 * on, blue for field labels, dim italic for anything not set yet, so unset
 * placeholders never read as real data.
 */
const STYLES: Record<
  LineStyle,
  { color?: string; bold?: boolean; dim?: boolean; italic?: boolean }
> = {
  title: { color: "cyan", bold: true },
  subtitle: { dim: true },
  label: { color: "blue", bold: true },
  value: {},
  placeholder: { dim: true, italic: true },
  item: {},
};

function ContentLine({ line }: { line: DisplayLine }) {
  if (line.segments.length === 0) return <Text> </Text>;
  return (
    <Text>
      {line.indent > 0 ? " ".repeat(line.indent) : ""}
      {line.segments.map((segment, i) => {
        const style = STYLES[segment.style];
        return (
          <Text
            key={i}
            bold={style.bold}
            color={style.color}
            dimColor={style.dim}
            italic={style.italic}
          >
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}

/** Seed a fresh game, stamping the timestamp at call time. */
function newGameStateFor(adventure: Adventure): GameState {
  return newGameState(adventure, new Date().toISOString());
}

const INITIAL_SELECTION: SelectionByCategory = {
  config: 0,
  beats: 0,
  characters: 0,
  rooms: 0,
  items: 0,
  logs: 0,
};

/** One sidebar row, unifying an entity entry and a session-log listing. */
interface SidebarRow {
  key: string;
  label: string;
  broken: boolean;
}

/** e.g. `2026-07-28T14:32:07.000Z · dev` — when it ran and what started it. */
function logLabel(entry: SessionLogListing): string {
  return `${entry.startedAt} · ${entry.source}`;
}

function findEntity(
  adventure: Adventure,
  entry: CatalogEntry,
): Room | Item | Character | StoryBeat | undefined {
  switch (entry.kind) {
    case "room":
      return adventure.entities?.rooms?.find((r) => r.id === entry.id);
    case "item":
      return adventure.entities?.items?.find((i) => i.id === entry.id);
    case "character":
      return adventure.entities?.characters?.find((c) => c.id === entry.id);
    case "beat":
      return adventure.beats?.find((b) => b.id === entry.id);
  }
}

/**
 * The `xyzzy dev` browsing screen: a fixed category sidebar with the selected
 * category's entities beneath it, and a content pane showing the selected
 * entity's fields rendered as labelled rows (never raw YAML).
 */
export function DevApp({
  adventure: initialAdventure,
  adventureDir,
  openEditor,
  provider,
  makeModel,
  makeDetector,
  listModels,
  providers = {},
  saveSlot = "autosave",
}: DevAppProps) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const layout = devLayout(columns, rows);
  const [category, setCategory] = useState<Category>("config");
  const [selection, setSelection] =
    useState<SelectionByCategory>(INITIAL_SELECTION);
  const [adventure, setAdventure] = useState(initialAdventure);
  const [issues, setIssues] = useState<Record<string, ValidationIssue[]>>({});
  const [sources, setSources] = useState<EntitySourceMap>(() =>
    readSourcesSafely(adventureDir),
  );
  const [focus, setFocus] = useState<Focus>("sidebar");
  const [playState, setPlayState] = useState<GameState | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuIndex, setSubmenuIndex] = useState(0);
  const [scroll, setScroll] = useState(0);
  // Refreshed whenever a session starts, so a log you just played shows up
  // without restarting the tool.
  const [logEntries, setLogEntries] = useState<SessionLogListing[]>(() =>
    listSessionLogs(initialAdventure.meta.id),
  );
  const [sessionLogHandle, setSessionLogHandle] = useState<
    SessionLogHandle | undefined
  >();

  const saves = listSaves(adventure.meta.id);
  const submenuOptions = ["New Game", ...saves];
  // Without these a session can't be mounted, so `p` must not offer one —
  // starting one anyway would move focus to a pane that never appears.
  const canPlay = Boolean(provider && makeModel && listModels);

  async function startPlay(optionIndex: number) {
    const resumedFrom = optionIndex === 0 ? null : saves[optionIndex - 1]!;
    const state =
      resumedFrom === null
        ? newGameStateFor(adventure)
        : await loadGame(adventure.meta.id, resumedFrom);

    // Every dev-tool session is recorded — that is the whole point of the tool.
    // Guarded on `provider` only because the header records it.
    if (provider) {
      const handle = startSessionLog({
        adventureId: adventure.meta.id,
        source: "dev",
        provider: {
          kind: provider.kind,
          baseURL: provider.baseURL,
          model: provider.model,
        },
        saveSlot,
        resumedFrom,
      });
      setSessionLogHandle(handle);
      setLogEntries(listSessionLogs(adventure.meta.id));
    }
    setPlayState(state);
    setSubmenuOpen(false);
    setFocus("play");
  }

  const entries = entriesForCategory(adventure, category);
  // Logs are listed separately from `entriesForCategory` (a session file is not
  // an entity: no id collisions, no editor target, no validation issues), so
  // every selection bound is expressed against this count rather than `entries`.
  const entryCount = category === "logs" ? logEntries.length : entries.length;
  const index = entryCount === 0 ? 0 : Math.min(selection[category], entryCount - 1);
  const currentEntry =
    category === "config" || category === "logs" ? undefined : entries[index];
  const selectedLog = category === "logs" ? logEntries[index] : undefined;
  const currentKey =
    category === "config"
      ? CONFIG_KEY
      : currentEntry
        ? entityKey(currentEntry.kind, currentEntry.id)
        : undefined;

  /**
   * The selected log's parsed contents. Re-read per render rather than cached:
   * cheap at any plausible log size, and it means a session still being played
   * shows its newest turns without any invalidation machinery.
   */
  const logContent =
    selectedLog !== undefined
      ? (() => {
          try {
            return { records: readSessionLog(selectedLog.path), error: null };
          } catch (err) {
            return {
              records: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })()
      : { records: [], error: null };

  /**
   * Where an entity is actually defined — which may be `adventure.yaml`, or a
   * file under the kind directory holding several entities under a name
   * unrelated to any of their ids. Only falls back to the `xyzzy new` creation
   * convention for an entity we have no record of.
   */
  function sourceFile(entry: CatalogEntry): string {
    return (
      sources.get(entityKey(entry.kind, entry.id)) ??
      entityFilePath(adventureDir, entry.kind, entry.id)
    );
  }

  /**
   * Open the selected entity's file in the editor, then reload and re-validate
   * the whole adventure. On failure the previous good `adventure` is kept (so
   * every other entity stays browsable) and the issues are attributed to the
   * entity that was just edited.
   */
  function editSelected() {
    const path =
      category === "config"
        ? resolveAdventureFile(adventureDir)
        : currentEntry
          ? sourceFile(currentEntry)
          : undefined;
    if (!path || !currentKey) return;

    // A missing or unlaunchable $EDITOR is reported like any other problem —
    // silently doing nothing is indistinguishable from a dead keybinding.
    // Nothing was edited, so there is nothing to reload.
    try {
      openEditor?.(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIssues((prev) => ({
        ...prev,
        [currentKey]: [{ path: "(editor)", message }],
      }));
      return;
    }

    // A syntax error in what the editor saved makes the reload throw; that
    // must surface in the banner like any other problem, not tear down the
    // tool from inside a key handler.
    let result;
    let reloaded: unknown;
    try {
      const read = readAdventureFileWithSources(adventureDir);
      reloaded = read.raw;
      setSources(read.sources);
      result = validateAdventure(reloaded);
    } catch (err) {
      result = {
        ok: false,
        issues: [
          {
            path: "(file)",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }

    if (result.ok) {
      setAdventure(AdventureSchema.parse(reloaded));
      setIssues((prev) => {
        if (!(currentKey in prev)) return prev;
        const next = { ...prev };
        delete next[currentKey];
        return next;
      });
    } else {
      setIssues((prev) => ({ ...prev, [currentKey]: result.issues }));
    }
  }

  const fieldRows: FieldRow[] =
    category === "config"
      ? renderConfigFields(adventure)
      : category === "logs"
        ? renderSessionLogFields(logContent.records)
        : (() => {
            const entry = entries[index];
            if (!entry) return [];
            const entity = findEntity(adventure, entry);
            return entity ? renderFieldsFor(category, entity) : [];
          })();

  // Flatten to exact terminal rows so the pane can never hand Ink more lines
  // than it has room for — Ink garbles an overflowing box rather than clipping.
  const paneWidth = contentPaneWidth(layout);
  const paneHeight = contentPaneHeight(layout);
  const contentLines = layoutFieldRows(fieldRows, paneWidth ?? 80);
  const visibleHeight = paneHeight ?? contentLines.length;
  const maxScroll = Math.max(0, contentLines.length - visibleHeight);
  const scrollOffset = clampScroll(scroll, contentLines.length, visibleHeight);
  const canScrollContent = maxScroll > 0;
  /** Scroll a screenful at a time, keeping one line of context. */
  const pageStep = Math.max(1, visibleHeight - 1);
  const visibleLines = contentLines.slice(
    scrollOffset,
    scrollOffset + visibleHeight,
  );

  useInput((input, key) => {
    if (key.escape) {
      setSubmenuOpen(false);
      setFocus("sidebar");
      return;
    }
    if (submenuOpen) {
      if (key.downArrow) {
        setSubmenuIndex((i) => Math.min(submenuOptions.length - 1, i + 1));
        return;
      }
      if (key.upArrow) {
        setSubmenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.return) {
        void startPlay(submenuIndex);
        return;
      }
      return;
    }
    if (input === "p" && canPlay) {
      // A live session re-focuses; otherwise offer New Game / Resume.
      if (playState) setFocus("play");
      else {
        setSubmenuIndex(0);
        setSubmenuOpen(true);
      }
      return;
    }
    // Everything below belongs to the embedded App while it has focus — so a
    // literal "q" typed at the play prompt isn't a global quit.
    if (focus === "play") return;

    if (input === "q") {
      exit();
      return;
    }
    // Page keys scroll the content pane; ↑/↓ stay with entity selection.
    // Clamped on the way in so a run of PgDn past the end doesn't leave PgUp
    // pressing against a phantom offset before anything moves.
    if (key.pageDown) {
      setScroll((s) => Math.min(maxScroll, s + pageStep));
      return;
    }
    if (key.pageUp) {
      setScroll((s) => Math.max(0, s - pageStep));
      return;
    }
    if (key.tab) {
      const step = key.shift ? -1 : 1;
      const i = CATEGORIES.indexOf(category);
      setCategory(
        CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!,
      );
      setScroll(0);
      return;
    }
    // A log is read like a document, so there the arrows swap roles: up/down
    // scroll it a line at a time and left/right move between sessions. Every
    // other category keeps up/down on selection, where the entries are short.
    const selectStep = (delta: number) => {
      if (entryCount === 0) return;
      setSelection((s) => ({
        ...s,
        [category]: Math.min(entryCount - 1, Math.max(0, index + delta)),
      }));
      setScroll(0);
    };

    if (category === "logs") {
      if (key.downArrow) {
        setScroll((s) => Math.min(maxScroll, s + 1));
        return;
      }
      if (key.upArrow) {
        setScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (key.rightArrow) {
        selectStep(1);
        return;
      }
      if (key.leftArrow) {
        selectStep(-1);
        return;
      }
    } else {
      if (key.downArrow && entryCount > 0) {
        selectStep(1);
        return;
      }
      if (key.upArrow && entryCount > 0) {
        selectStep(-1);
        return;
      }
    }
    // Logs are read-only, so `e` is inert there (and absent from the footer).
    if (input === "e" && category !== "logs") {
      editSelected();
      return;
    }
  });

  const currentIssues = currentKey ? issues[currentKey] : undefined;

  // Logs don't participate in the validation-issues map, so they never carry
  // the ⚠ glyph.
  const sidebarRows: SidebarRow[] =
    category === "logs"
      ? logEntries.map((l) => ({ key: l.file, label: logLabel(l), broken: false }))
      : entries.map((e) => ({
          key: entityKey(e.kind, e.id),
          label: e.label,
          broken: Boolean(issues[entityKey(e.kind, e.id)]),
        }));

  // Trimmed to whole keys that fit, so a narrow terminal drops entries rather
  // than letting Ink eat the key glyphs and leave unattributed labels.
  const hotKeys = fitHotKeys(
    hotKeysFor({
      focus,
      submenuOpen,
      entryCount,
      isConfigCategory: category === "config",
      isLogsCategory: category === "logs",
      hasLiveSession: playState !== null,
      canPlay,
      canScrollContent,
    }),
    layout.width,
  );

  return (
    <Box flexDirection="column" width={layout.width} height={layout.height}>
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        {/* Right border rules the full pane height on its own, so it tracks
            resizes without padding a character per row. */}
        <Box
          flexDirection="column"
          width={layout.sidebarWidth}
          flexShrink={0}
          marginRight={2}
          overflow="hidden"
          borderStyle="single"
          borderRight
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          borderRightColor="cyan"
          borderRightDimColor
        >
          {CATEGORIES.map((c) => (
            <Text key={c} inverse={c === category}>
              {CATEGORY_LABELS[c]}
            </Text>
          ))}
          <Text> </Text>
          {sidebarRows.map((row, i) => (
            <Text
              key={row.key}
              bold={i === index}
              color={row.broken ? "red" : i === index ? "cyan" : undefined}
            >
              {i === index ? "› " : "  "}
              {row.label}
              {row.broken ? " ⚠" : ""}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {submenuOpen ? (
            <Box flexDirection="column">
              <Text>Play:</Text>
              {submenuOptions.map((opt, i) => (
                <Text key={opt} inverse={i === submenuIndex}>
                  {opt}
                </Text>
              ))}
            </Box>
          ) : playState && provider && makeModel && listModels ? (
            <App
              adventure={adventure}
              initialState={playState}
              provider={provider}
              makeModel={makeModel}
              makeDetector={makeDetector}
              listModels={listModels}
              providers={providers}
              saveSlot={saveSlot}
              sessionLog={sessionLogHandle}
              inputActive={focus === "play"}
              // Embedded, so the transcript must stay inside the content pane
              // rather than being written above the whole screen via <Static>.
              scrollbackMode="bounded"
              scrollbackViewport={playViewport(layout)}
              onQuit={() => {
                setPlayState(null);
                setFocus("sidebar");
              }}
            />
          ) : logContent.error ? (
            <>
              <Text color="red">⚠ Could not read log:</Text>
              <Text color="red">{logContent.error}</Text>
            </>
          ) : currentIssues ? (
            <>
              <Text color="red">⚠ Validation failed:</Text>
              <Text color="red">{formatIssues(currentIssues)}</Text>
            </>
          ) : (
            visibleLines.map((line, i) => (
              <ContentLine key={scrollOffset + i} line={line} />
            ))
          )}
        </Box>
      </Box>

      {/* Rule separating the key list from the panes. A top border tracks the
          box width on its own, so it stays full-width across resizes. */}
      <Box
        flexShrink={0}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderTopColor="cyan"
        borderTopDimColor
      >
        {hotKeys.map((hotKey, i) => (
          <Text key={hotKey.key}>
            {i > 0 ? "   " : ""}
            <Text bold color="cyan">
              {hotKey.key}
            </Text>
            <Text dimColor> {hotKey.label}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
