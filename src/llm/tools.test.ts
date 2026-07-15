import { describe, expect, it } from "vitest";
import { ACTION_NAMES, ACTION_TOOLS, toAction } from "./tools.js";

describe("action tools", () => {
  it("exposes one tool per reducer action", () => {
    expect(ACTION_NAMES).toContain("moveTo");
    expect(ACTION_NAMES).toContain("appendCharacterHistory");
    expect(Object.keys(ACTION_TOOLS)).toHaveLength(ACTION_NAMES.length);
  });

  it("reconstructs a valid action from name + args", () => {
    expect(toAction("moveTo", { room: "hall" })).toEqual({
      type: "moveTo",
      room: "hall",
    });
  });

  it("returns null for an unknown tool name", () => {
    expect(toAction("teleport", { room: "x" })).toBeNull();
  });

  it("returns null when args fail validation", () => {
    expect(toAction("moveTo", {})).toBeNull();
    expect(toAction("setFlag", { key: "k", value: { nested: 1 } })).toBeNull();
  });
});
