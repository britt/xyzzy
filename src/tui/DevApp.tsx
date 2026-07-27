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
import { hotKeysFor } from "./dev/hotkeys.js";
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
};

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

  const saves = listSaves(adventureDir);
  const submenuOptions = ["New Game", ...saves];
  // Without these a session can't be mounted, so `p` must not offer one —
  // starting one anyway would move focus to a pane that never appears.
  const canPlay = Boolean(provider && makeModel && listModels);

  async function startPlay(optionIndex: number) {
    const state =
      optionIndex === 0
        ? newGameStateFor(adventure)
        : await loadGame(adventureDir, saves[optionIndex - 1]!);
    setPlayState(state);
    setSubmenuOpen(false);
    setFocus("play");
  }

  const entries = entriesForCategory(adventure, category);
  const index =
    entries.length === 0
      ? 0
      : Math.min(selection[category], entries.length - 1);
  const currentEntry = category === "config" ? undefined : entries[index];
  const currentKey =
    category === "config"
      ? CONFIG_KEY
      : currentEntry
        ? entityKey(currentEntry.kind, currentEntry.id)
        : undefined;

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
    if (key.downArrow && entries.length > 0) {
      setSelection((s) => ({
        ...s,
        [category]: Math.min(entries.length - 1, index + 1),
      }));
      setScroll(0);
      return;
    }
    if (key.upArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.max(0, index - 1) }));
      setScroll(0);
      return;
    }
    if (input === "e") {
      editSelected();
      return;
    }
  });

  const currentIssues = currentKey ? issues[currentKey] : undefined;

  const hotKeys = hotKeysFor({
    focus,
    submenuOpen,
    entryCount: entries.length,
    isConfigCategory: category === "config",
    hasLiveSession: playState !== null,
    canPlay,
    canScrollContent,
  });

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
          {entries.map((e, i) => {
            const broken = Boolean(issues[entityKey(e.kind, e.id)]);
            return (
              <Text
                key={`${e.kind}:${e.id}`}
                bold={i === index}
                color={broken ? "red" : i === index ? "cyan" : undefined}
              >
                {i === index ? "› " : "  "}
                {e.label}
                {broken ? " ⚠" : ""}
              </Text>
            );
          })}
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
              adventureDir={adventureDir}
              saveSlot={saveSlot}
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
