import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
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
