import { describe, expect, it } from "vitest";
import { clampScroll, layoutFieldRows, wrapText } from "./contentLines.js";
import type { FieldRow } from "./renderFields.js";

/** Flatten a laid-out line back to plain text, for readable assertions. */
const text = (line: { indent: number; segments: { text: string }[] }) =>
  " ".repeat(line.indent) + line.segments.map((s) => s.text).join("");

describe("wrapText", () => {
  it("returns short text unchanged", () => {
    expect(wrapText("hello", 20)).toEqual(["hello"]);
  });

  it("returns a single empty line for empty text", () => {
    expect(wrapText("", 20)).toEqual([""]);
  });

  it("wraps on word boundaries", () => {
    expect(wrapText("the quick brown fox", 10)).toEqual(["the quick", "brown fox"]);
  });

  it("honours explicit newlines", () => {
    expect(wrapText("one\ntwo", 20)).toEqual(["one", "two"]);
  });

  it("hard-splits a word longer than the width", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("never loops forever on a nonsense width", () => {
    expect(wrapText("ab", 0).join("")).toBe("ab");
  });
});

describe("layoutFieldRows", () => {
  const heading: FieldRow = { kind: "heading", title: "Cavern", subtitle: "cavern" };

  it("renders a heading as title over subtitle", () => {
    const lines = layoutFieldRows([heading], 40);
    expect(lines.map(text)).toEqual(["Cavern", "cavern"]);
    expect(lines[0]!.segments[0]!.style).toBe("title");
    expect(lines[1]!.segments[0]!.style).toBe("subtitle");
  });

  it("omits the subtitle line when a heading has none", () => {
    const lines = layoutFieldRows([{ kind: "heading", title: "won-the-key" }], 40);
    expect(lines.map(text)).toEqual(["won-the-key"]);
  });

  it("puts a short scalar on one line, label then value", () => {
    const row: FieldRow = { kind: "scalar", label: "Location", value: "cavern", dim: false };
    const lines = layoutFieldRows([row], 40);
    expect(lines.map(text)).toEqual(["Location cavern"]);
    expect(lines[0]!.segments.map((s) => s.style)).toEqual(["label", "value"]);
  });

  it("marks an unset scalar's value as a placeholder", () => {
    const row: FieldRow = { kind: "scalar", label: "Location", value: "<unset>", dim: true };
    const lines = layoutFieldRows([row], 40);
    expect(lines[0]!.segments[1]!.style).toBe("placeholder");
  });

  it("drops a long scalar's value onto indented lines under its label", () => {
    const row: FieldRow = {
      kind: "scalar",
      label: "Location",
      value: "a very long location value that will not fit",
      dim: false,
    };
    const lines = layoutFieldRows([row], 20);
    expect(text(lines[0]!)).toBe("Location");
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[1]!.indent).toBe(2);
  });

  it("renders a block as a label with its wrapped value indented beneath", () => {
    const row: FieldRow = {
      kind: "block",
      label: "Description",
      value: "the quick brown fox jumps",
      dim: false,
    };
    const lines = layoutFieldRows([row], 20);
    expect(text(lines[0]!)).toBe("Description");
    expect(lines.slice(1).every((l) => l.indent === 2)).toBe(true);
    expect(lines.slice(1).map((l) => l.segments[0]!.text).join(" ")).toContain("quick");
  });

  it("bullets each list item under its label", () => {
    const row: FieldRow = {
      kind: "list",
      label: "Exits",
      items: ["north → hall", "down → pit"],
    };
    expect(layoutFieldRows([row], 40).map(text)).toEqual([
      "Exits",
      "  · north → hall",
      "  · down → pit",
    ]);
  });

  it("shows a placeholder for an empty list", () => {
    const row: FieldRow = { kind: "list", label: "Exits", items: [] };
    const lines = layoutFieldRows([row], 40);
    expect(lines.map(text)).toEqual(["Exits", "  (none)"]);
    expect(lines[1]!.segments[0]!.style).toBe("placeholder");
  });

  it("separates groups with a blank line but leaves none trailing", () => {
    const rows: FieldRow[] = [
      heading,
      { kind: "list", label: "Exits", items: ["north → hall"] },
    ];
    expect(layoutFieldRows(rows, 40).map(text)).toEqual([
      "Cavern",
      "cavern",
      "",
      "Exits",
      "  · north → hall",
    ]);
  });

  it("produces one entry per terminal row, so the caller can size exactly", () => {
    const rows: FieldRow[] = [
      heading,
      { kind: "block", label: "Description", value: "a b c d e f g h", dim: false },
    ];
    for (const line of layoutFieldRows(rows, 10)) {
      expect(text(line).length).toBeLessThanOrEqual(10);
    }
  });
});

describe("clampScroll", () => {
  it("never goes below zero", () => {
    expect(clampScroll(-5, 100, 10)).toBe(0);
  });

  it("stops so the last line stays on screen", () => {
    expect(clampScroll(999, 100, 10)).toBe(90);
  });

  it("pins to the top when everything already fits", () => {
    expect(clampScroll(5, 4, 10)).toBe(0);
  });

  it("leaves a valid offset alone", () => {
    expect(clampScroll(7, 100, 10)).toBe(7);
  });
});

describe("rule rows", () => {
  it("renders a solid rule as a full-width line", () => {
    const lines = layoutFieldRows([{ kind: "rule", style: "solid" }], 10);
    expect(lines).toEqual([
      { indent: 0, segments: [{ text: "─".repeat(10), style: "rule" }] },
    ]);
  });

  it("renders a dotted rule with a visibly different glyph", () => {
    const lines = layoutFieldRows([{ kind: "rule", style: "dotted" }], 8);
    expect(lines).toEqual([
      { indent: 0, segments: [{ text: "┄".repeat(8), style: "rule" }] },
    ]);
  });

  it("never exceeds the pane width", () => {
    for (const width of [1, 5, 40, 120]) {
      const [line] = layoutFieldRows([{ kind: "rule", style: "solid" }], width);
      expect(line!.segments[0]!.text).toHaveLength(width);
    }
  });
});
