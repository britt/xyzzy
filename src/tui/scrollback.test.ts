import { describe, expect, it } from "vitest";
import { visibleScrollback, wrappedHeight } from "./scrollback.js";

describe("wrappedHeight", () => {
  it("counts a short line as one row", () => {
    expect(wrappedHeight("abc", 10)).toBe(1);
  });

  it("counts an empty line as one row", () => {
    expect(wrappedHeight("", 10)).toBe(1);
  });

  it("counts wrapped rows for text longer than the width", () => {
    expect(wrappedHeight("a".repeat(25), 10)).toBe(3);
    expect(wrappedHeight("a".repeat(20), 10)).toBe(2);
  });

  it("counts explicit newlines", () => {
    expect(wrappedHeight("one\ntwo\nthree", 10)).toBe(3);
  });

  it("combines wrapping and explicit newlines", () => {
    expect(wrappedHeight(`${"a".repeat(25)}\nshort`, 10)).toBe(4);
  });

  it("survives a nonsense width instead of dividing by zero", () => {
    expect(wrappedHeight("abc", 0)).toBeGreaterThan(0);
    expect(Number.isFinite(wrappedHeight("abc", -5))).toBe(true);
  });
});

describe("visibleScrollback", () => {
  const entry = (text: string) => ({ text });

  it("returns everything when it all fits", () => {
    const entries = [entry("a"), entry("b"), entry("c")];
    expect(visibleScrollback(entries, { rows: 10, width: 20, gap: 0 })).toEqual(entries);
  });

  it("keeps only the newest entries that fit, in original order", () => {
    const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
    expect(visibleScrollback(entries, { rows: 2, width: 20, gap: 0 })).toEqual([
      entry("c"),
      entry("d"),
    ]);
  });

  it("accounts for the blank row between entries", () => {
    const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
    // gap of 1 makes each entry cost 2 rows, so 4 rows fits exactly two.
    expect(visibleScrollback(entries, { rows: 4, width: 20, gap: 1 })).toEqual([
      entry("c"),
      entry("d"),
    ]);
  });

  it("accounts for wrapped entries costing more than one row", () => {
    const entries = [entry("short"), entry("x".repeat(30))];
    // The long entry alone occupies 3 rows, leaving no room for the short one.
    expect(visibleScrollback(entries, { rows: 3, width: 10, gap: 0 })).toEqual([
      entry("x".repeat(30)),
    ]);
  });

  it("always shows the newest entry even when it alone overflows", () => {
    const entries = [entry("old"), entry("y".repeat(100))];
    expect(visibleScrollback(entries, { rows: 2, width: 10, gap: 0 })).toEqual([
      entry("y".repeat(100)),
    ]);
  });

  it("returns everything when the height is unknown, leaving Ink to size itself", () => {
    const entries = [entry("a"), entry("b")];
    expect(visibleScrollback(entries, { rows: undefined, width: 20 })).toEqual(entries);
  });

  it("handles an empty list", () => {
    expect(visibleScrollback([], { rows: 5, width: 20 })).toEqual([]);
  });
});
