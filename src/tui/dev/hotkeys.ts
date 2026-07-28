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

  // Up/Down only move the selection when there is somewhere to move to.
  if (!isConfigCategory && entryCount > 1) {
    keys.push({ key: "↑↓", label: "Entity" });
  }
  if (canScrollContent) {
    keys.push({ key: "PgUp/PgDn", label: "Scroll" });
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
