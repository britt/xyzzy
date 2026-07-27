/**
 * Bounding the play screen's scrollback.
 *
 * Narration used to be emitted through Ink's `<Static>`, which writes each line
 * permanently above the live frame. That kept the frame small for free, but it
 * also meant nothing could ever be drawn around the transcript — static output
 * always lands above everything else. Rendering the transcript as ordinary
 * children buys that freedom, at the cost of having to keep the frame shorter
 * than the terminal ourselves: once a frame reaches `stdout.rows`, Ink stops
 * diffing and clears + redraws the whole terminal every render.
 *
 * So we show the newest entries that fit and drop the rest.
 */

/** Rows a string occupies once wrapped to `width`, counting explicit newlines. */
export function wrappedHeight(text: string, width: number): number {
  const usable = Math.max(1, Math.floor(width));
  let rows = 0;
  for (const line of text.split("\n")) {
    rows += Math.max(1, Math.ceil(line.length / usable));
  }
  return Math.max(1, rows);
}

export interface VisibleScrollbackOptions {
  /** Rows available for the transcript; undefined means "unbounded". */
  rows: number | undefined;
  /** Width the transcript wraps at. */
  width: number;
  /** Blank rows rendered after each entry. Defaults to 1. */
  gap?: number;
}

/**
 * The newest entries that fit in `rows`, in their original order. The most
 * recent entry is always included even if it alone overflows — showing a
 * clipped latest turn beats showing nothing.
 */
export function visibleScrollback<T extends { text: string }>(
  entries: readonly T[],
  options: VisibleScrollbackOptions,
): T[] {
  const { rows, width, gap = 1 } = options;
  if (rows === undefined) return [...entries];
  if (entries.length === 0) return [];

  const budget = Math.max(1, rows);
  let used = 0;
  let firstVisible = entries.length;

  for (let i = entries.length - 1; i >= 0; i--) {
    const cost = wrappedHeight(entries[i]!.text, width) + gap;
    if (i < entries.length - 1 && used + cost > budget) break;
    used += cost;
    firstVisible = i;
  }

  return entries.slice(firstVisible);
}
