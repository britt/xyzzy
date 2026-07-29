/**
 * The hot keys the footer advertises.
 *
 * The contract is that a key is listed only when pressing it right now would
 * actually do something, so this mirrors `DevApp`'s input handler exactly:
 * the play submenu swallows everything but its own keys, an active play
 * session owns every key except Escape, and the sidebar's entity keys depend
 * on there being an entity to act on.
 */

export interface HotKey {
  /** How the key is printed, e.g. `"Tab"`, `"↑↓"`, `"e"`. */
  key: string;
  label: string;
}

export interface HotKeyContext {
  focus: "sidebar" | "play";
  submenuOpen: boolean;
  /** Entities listed in the current category. */
  entryCount: number;
  /** The config category has no entity list, but is always editable. */
  isConfigCategory: boolean;
  /** Logs are read-only — Edit is never offered regardless of entryCount. */
  isLogsCategory: boolean;
  hasLiveSession: boolean;
  /** Whether a provider and model factory are available to start a session. */
  canPlay: boolean;
  /** Whether the content pane has more lines than fit. */
  canScrollContent?: boolean;
}

export function hotKeysFor(context: HotKeyContext): HotKey[] {
  const {
    focus,
    submenuOpen,
    entryCount,
    isConfigCategory,
    isLogsCategory,
    hasLiveSession,
    canPlay,
    canScrollContent = false,
  } = context;

  if (submenuOpen) {
    return [
      { key: "↑↓", label: "Choose" },
      { key: "Enter", label: "Start" },
      { key: "Esc", label: "Cancel" },
    ];
  }

  if (focus === "play") {
    return [{ key: "Esc", label: "Sidebar" }];
  }

  const keys: HotKey[] = [{ key: "Tab", label: "Category" }];

  if (isLogsCategory) {
    // A log is a document you read rather than a record you inspect, so the
    // arrows swap roles here: up/down scroll it a line at a time, and moving
    // between sessions — the rarer action — becomes left/right.
    if (canScrollContent) keys.push({ key: "↑↓", label: "Scroll" });
    if (entryCount > 1) keys.push({ key: "←→", label: "Session" });
    if (canScrollContent) keys.push({ key: "PgUp/PgDn", label: "Page" });
  } else {
    // Up/Down only move the selection when there is somewhere to move to.
    if (!isConfigCategory && entryCount > 1) {
      keys.push({ key: "↑↓", label: "Entity" });
    }
    if (canScrollContent) {
      keys.push({ key: "PgUp/PgDn", label: "Scroll" });
    }
  }
  // Editing needs a selection; the config category always has one implicitly.
  // Logs are read-only, so `e` is never offered there however many exist.
  if (!isLogsCategory && (isConfigCategory || entryCount > 0)) {
    keys.push({ key: "e", label: "Edit" });
  }
  if (canPlay) {
    keys.push({ key: "p", label: hasLiveSession ? "Resume" : "Play" });
  }
  keys.push({ key: "q", label: "Quit" });

  return keys;
}

/** Columns between two rendered keys in the footer. */
const HOTKEY_GAP = 3;

/** Columns one key occupies, rendered as `"<key> <label>"`. */
function hotKeyWidth(hotKey: HotKey): number {
  return hotKey.key.length + 1 + hotKey.label.length;
}

/**
 * Trim the footer to whole keys that fit `width`.
 *
 * Ink does not clip an overflowing footer usefully: it shrinks the flex row by
 * eating the leading `<Text>` of each entry — which is the key glyph — leaving
 * a row of labels with no way to tell what to press. So the trimming happens
 * here, in whole entries, the same reason `contentLines.ts` flattens the
 * content pane itself rather than handing Ink too many rows.
 *
 * The last key is always kept: it is `q Quit`, and a footer that cannot tell
 * you how to leave is the one failure worth reserving space for.
 */
export function fitHotKeys(
  hotKeys: HotKey[],
  width: number | undefined,
): HotKey[] {
  if (width === undefined || hotKeys.length === 0) return hotKeys;

  const total =
    hotKeys.reduce((sum, k) => sum + hotKeyWidth(k), 0) +
    HOTKEY_GAP * (hotKeys.length - 1);
  if (total <= width) return hotKeys;

  const last = hotKeys[hotKeys.length - 1]!;
  const kept: HotKey[] = [];
  let used = hotKeyWidth(last);
  for (const hotKey of hotKeys.slice(0, -1)) {
    const cost = hotKeyWidth(hotKey) + HOTKEY_GAP;
    if (used + cost > width) break;
    used += cost;
    kept.push(hotKey);
  }
  return [...kept, last];
}
