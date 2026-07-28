import { afterEach, describe, expect, it } from "vitest";
import { sessionLogPath } from "./sessionLog.js";

describe("sessionLogPath", () => {
  const savedState = process.env.XDG_STATE_HOME;
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  it("nests under $XDG_STATE_HOME/xyzzy/<slug>/logs/<session>.jsonl", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg";
    expect(sessionLogPath("cave-of-echoes", "2026-07-28T14-32-07")).toBe(
      "/tmp/xdg/xyzzy/cave-of-echoes/logs/2026-07-28T14-32-07.jsonl",
    );
  });

  it("slugifies an adventure id with punctuation, mirroring savesDir", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg";
    expect(sessionLogPath("My Adventure!", "s1")).toBe(
      "/tmp/xdg/xyzzy/my-adventure/logs/s1.jsonl",
    );
  });

  it("falls back to a hex encoding for an id that slugifies to empty", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg";
    const hex = Buffer.from("...", "utf8").toString("hex");
    expect(sessionLogPath("...", "s1")).toBe(`/tmp/xdg/xyzzy/${hex}/logs/s1.jsonl`);
  });
});
