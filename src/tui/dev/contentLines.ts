import type { FieldRow } from "./renderFields.js";

/**
 * Flattening the content pane to exact terminal rows.
 *
 * Ink's `overflow: "hidden"` does not truncate a too-tall pane cleanly — it
 * garbles it, interleaving labels and values. So rather than handing Ink more
 * rows than the box has and hoping, we wrap and flatten ourselves, then render
 * only the window the caller asks for. One entry here is exactly one terminal
 * row, which makes scrolling a plain slice.
 */

export type LineStyle =
  | "title"
  | "subtitle"
  | "label"
  | "value"
  | "placeholder"
  | "item";

export interface DisplaySegment {
  text: string;
  style: LineStyle;
}

export interface DisplayLine {
  indent: number;
  /** Empty for a blank spacer row. */
  segments: DisplaySegment[];
}

const BLANK: DisplayLine = { indent: 0, segments: [] };
const INDENT = 2;

/** Word-wrap to `width`, honouring explicit newlines and hard-splitting any
 * single word too long to fit. Always returns at least one line. */
export function wrapText(text: string, width: number): string[] {
  const usable = Math.max(1, Math.floor(width));
  const out: string[] = [];

  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      let remaining = word;
      // A word longer than the line gets broken across lines.
      while (remaining.length > usable) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(remaining.slice(0, usable));
        remaining = remaining.slice(usable);
      }
      if (line === "") {
        line = remaining;
      } else if (line.length + 1 + remaining.length <= usable) {
        line += ` ${remaining}`;
      } else {
        out.push(line);
        line = remaining;
      }
    }
    out.push(line);
  }

  return out.length > 0 ? out : [""];
}

function styled(text: string, style: LineStyle, indent = 0): DisplayLine {
  return { indent, segments: [{ text, style }] };
}

/** Wrap any single-style text to the pane, so no row can ever exceed it. */
function wrapped(
  text: string,
  style: LineStyle,
  width: number,
  indent = 0,
): DisplayLine[] {
  return wrapText(text, width - indent).map((line) => styled(line, style, indent));
}

function valueStyle(dim: boolean): LineStyle {
  return dim ? "placeholder" : "value";
}

/** Lay a single field row out as terminal rows. */
function layoutRow(row: FieldRow, width: number): DisplayLine[] {
  switch (row.kind) {
    case "heading": {
      const lines = wrapped(row.title, "title", width);
      if (row.subtitle !== undefined) {
        lines.push(...wrapped(row.subtitle, "subtitle", width));
      }
      return lines;
    }

    case "scalar": {
      const inline = `${row.label} ${row.value}`;
      if (inline.length <= width) {
        return [
          {
            indent: 0,
            segments: [
              { text: `${row.label} `, style: "label" },
              { text: row.value, style: valueStyle(row.dim) },
            ],
          },
        ];
      }
      // Too long to sit beside its label; fall back to the block treatment.
      return [
        ...wrapped(row.label, "label", width),
        ...wrapped(row.value, valueStyle(row.dim), width, INDENT),
      ];
    }

    case "block":
      return [
        ...wrapped(row.label, "label", width),
        ...wrapped(row.value, valueStyle(row.dim), width, INDENT),
      ];

    case "list": {
      if (row.items.length === 0) {
        return [
          ...wrapped(row.label, "label", width),
          styled("(none)", "placeholder", INDENT),
        ];
      }
      const lines = wrapped(row.label, "label", width);
      for (const item of row.items) {
        // "· " occupies two columns; continuations align past the bullet.
        const itemLines = wrapText(item, width - INDENT - 2);
        itemLines.forEach((line, i) => {
          lines.push(styled(i === 0 ? `· ${line}` : `  ${line}`, "item", INDENT));
        });
      }
      return lines;
    }
  }
}

/**
 * Flatten field rows to terminal rows, one entry per row, separated by a blank
 * line between groups (never a trailing one).
 */
export function layoutFieldRows(rows: FieldRow[], width: number): DisplayLine[] {
  const usable = Math.max(1, Math.floor(width));
  const out: DisplayLine[] = [];

  rows.forEach((row, i) => {
    if (i > 0) out.push(BLANK);
    out.push(...layoutRow(row, usable));
  });

  return out;
}

/** Keep a scroll offset within range for `total` lines shown `height` at a time. */
export function clampScroll(offset: number, total: number, height: number): number {
  const maxOffset = Math.max(0, total - Math.max(1, height));
  return Math.min(maxOffset, Math.max(0, offset));
}
