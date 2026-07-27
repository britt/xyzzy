/**
 * Geometry for the `xyzzy dev` two-pane screen, kept pure so the sizing rules
 * are testable without a terminal.
 */

export const MIN_SIDEBAR_WIDTH = 18;
export const MAX_SIDEBAR_WIDTH = 32;
/** Used when the terminal size can't be determined (non-TTY, test stdout). */
export const DEFAULT_SIDEBAR_WIDTH = 26;
/** Columns between the sidebar and the content pane. */
export const SIDEBAR_GAP = 2;

export interface DevLayout {
  /** Full terminal width, or undefined to let Ink size to content. */
  width: number | undefined;
  /** Full terminal height less one row, or undefined to size to content. */
  height: number | undefined;
  sidebarWidth: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Size the screen to the terminal.
 *
 * Height deliberately stops one row short: Ink switches from differential
 * updates to clearing and redrawing the entire terminal — re-emitting every
 * accumulated `<Static>` line — as soon as the frame height reaches
 * `stdout.rows` (see `ink/build/ink.js`, the `outputHeight >= rows` branch).
 * With the trailing newline the frame still occupies the whole window.
 */
export function devLayout(
  columns: number | undefined,
  rows: number | undefined,
): DevLayout {
  const width = typeof columns === "number" && columns > 0 ? columns : undefined;
  const height = typeof rows === "number" && rows > 1 ? rows - 1 : undefined;

  let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  if (width !== undefined) {
    sidebarWidth = clamp(
      Math.floor(width / 4),
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    );
    // On a terminal too narrow for both panes, keep the sidebar a minority
    // share rather than squeezing the content pane to nothing.
    sidebarWidth = Math.min(sidebarWidth, Math.max(1, Math.floor(width / 2)));
  }

  return { width, height, sidebarWidth };
}

/** Rows the play pane spends on its status bar and input line. */
export const PLAY_CHROME_ROWS = 3;
/** Rows the hot-key footer occupies at the bottom of the screen. */
export const FOOTER_ROWS = 1;

/**
 * Viewport for an embedded play session's bounded scrollback: the content
 * pane's interior, less the rows its own status bar and input line occupy.
 * Undefined when the terminal size is unknown, which leaves the panel to size
 * itself to its content.
 */
export function playViewport(
  layout: DevLayout,
): { rows: number; width: number } | undefined {
  if (layout.height === undefined || layout.width === undefined) return undefined;
  const width = Math.max(1, layout.width - layout.sidebarWidth - SIDEBAR_GAP);
  const rows = Math.max(1, layout.height - PLAY_CHROME_ROWS - FOOTER_ROWS);
  return { rows, width };
}
