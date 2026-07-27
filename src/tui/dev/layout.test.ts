import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  PLAY_CHROME_ROWS,
  SIDEBAR_GAP,
  playViewport,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  devLayout,
} from "./layout.js";

describe("devLayout", () => {
  it("fills the full terminal width", () => {
    expect(devLayout(120, 40).width).toBe(120);
  });

  it("reserves one row so the frame fills the window without scrolling it", () => {
    // Ink falls back to clearing and redrawing the whole terminal (including
    // all accumulated <Static> output) once the frame height reaches
    // stdout.rows, so a full-height app must stay one row under.
    expect(devLayout(120, 40).height).toBe(39);
  });

  it("leaves width and height unset when the terminal size is unknown", () => {
    const layout = devLayout(undefined, undefined);
    expect(layout.width).toBeUndefined();
    expect(layout.height).toBeUndefined();
    expect(layout.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("leaves height unset for a degenerate terminal height", () => {
    expect(devLayout(80, 1).height).toBeUndefined();
    expect(devLayout(80, 0).height).toBeUndefined();
  });

  it("scales the sidebar with the terminal, within bounds", () => {
    expect(devLayout(120, 40).sidebarWidth).toBe(30);
    expect(devLayout(200, 40).sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);
    expect(devLayout(40, 40).sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("never lets the sidebar crowd out the content pane on a narrow terminal", () => {
    const layout = devLayout(24, 40);
    expect(layout.sidebarWidth).toBeLessThan(24);
    expect(layout.sidebarWidth).toBeGreaterThan(0);
  });
});

describe("playViewport", () => {
  it("gives the play pane the content pane's interior, less its own chrome", () => {
    const layout = devLayout(120, 40); // width 120, height 39, sidebar 30
    expect(playViewport(layout)).toEqual({
      width: 120 - 30 - SIDEBAR_GAP,
      rows: 39 - PLAY_CHROME_ROWS,
    });
  });

  it("is undefined when the terminal size is unknown, leaving the panel unbounded", () => {
    expect(playViewport(devLayout(undefined, undefined))).toBeUndefined();
  });

  it("never returns a non-positive width or height", () => {
    const viewport = playViewport(devLayout(10, 3));
    expect(viewport!.width).toBeGreaterThan(0);
    expect(viewport!.rows).toBeGreaterThan(0);
  });
});
