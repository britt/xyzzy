import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeNarratorModel } from "./NarratorModel.js";
import { FakeDetector } from "./Detector.js";
import { SessionRecorder, sessionLogPath, startSessionLog } from "./sessionLog.js";

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

const NARRATOR_CTX = {
  systemPrompt: "sp",
  digest: "d",
  transcript: [],
  input: "look",
};

const DETECTOR_CTX = {
  input: "go north",
  exits: [],
  activeBeats: [],
  characterBeats: [],
  interactions: [],
};

describe("SessionRecorder", () => {
  it("wraps a narrator model, buffering successful calls and forwarding the result", async () => {
    const recorder = new SessionRecorder();
    const model = new FakeNarratorModel([{ narration: "Hi.", actions: [] }]);
    const wrapped = recorder.wrapModel(model);

    const result = await wrapped.generate(NARRATOR_CTX);
    expect(result).toEqual({ narration: "Hi.", actions: [] });

    const turn = recorder.flushTurn(1, "look");
    expect(turn.narrator).toEqual([
      {
        context: NARRATOR_CTX,
        ms: expect.any(Number),
        ok: true,
        result: { narration: "Hi.", actions: [] },
      },
    ]);
    expect(turn.detector).toEqual([]);
    expect(turn.type).toBe("turn");
    expect(turn.turn).toBe(1);
    expect(turn.input).toBe("look");
  });

  it("records a failed narrator call and rethrows", async () => {
    const recorder = new SessionRecorder();
    const failing = { generate: () => Promise.reject(new Error("boom")) };
    const wrapped = recorder.wrapModel(failing);

    await expect(wrapped.generate(NARRATOR_CTX)).rejects.toThrow("boom");

    const turn = recorder.flushTurn(1, "look");
    expect(turn.narrator).toEqual([
      {
        context: NARRATOR_CTX,
        ms: expect.any(Number),
        ok: false,
        error: expect.objectContaining({ message: "boom" }),
      },
    ]);
  });

  it("wraps a detector the same way", async () => {
    const recorder = new SessionRecorder();
    const detector = new FakeDetector([
      { move: null, advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
    ]);
    const wrapped = recorder.wrapDetector(detector);
    await wrapped.detect(DETECTOR_CTX);

    const turn = recorder.flushTurn(1, "go north");
    expect(turn.detector).toHaveLength(1);
    expect(turn.detector[0]).toMatchObject({ ok: true, context: DETECTOR_CTX });
  });

  it("records a failed detector call and rethrows", async () => {
    const recorder = new SessionRecorder();
    const wrapped = recorder.wrapDetector({
      detect: () => Promise.reject(new Error("nope")),
    });

    await expect(wrapped.detect(DETECTOR_CTX)).rejects.toThrow("nope");

    const turn = recorder.flushTurn(1, "go north");
    expect(turn.detector).toEqual([
      {
        context: DETECTOR_CTX,
        ms: expect.any(Number),
        ok: false,
        error: expect.objectContaining({ message: "nope" }),
      },
    ]);
  });

  it("clears buffers after flushTurn, so the next turn starts empty", async () => {
    const recorder = new SessionRecorder();
    const model = new FakeNarratorModel([{ narration: "Hi.", actions: [] }]);
    const wrapped = recorder.wrapModel(model);
    await wrapped.generate(NARRATOR_CTX);
    recorder.flushTurn(1, "look");

    const second = recorder.flushTurn(2, "look again");
    expect(second.narrator).toEqual([]);
  });
});

/** Point the XDG state dir at a scratch directory for the duration of a block. */
function isolateStateHome(prefix: string) {
  const savedState = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), prefix));
  });
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });
}

function lines(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("startSessionLog", () => {
  isolateStateHome("xyzzy-sessionlog-");

  it("writes a session header line immediately, before any turn", () => {
    const handle = startSessionLog({
      adventureId: "cave",
      source: "dev",
      provider: {
        kind: "openai-compatible",
        baseURL: "http://localhost:11434/v1",
        model: "llama3.1",
      },
      saveSlot: "autosave",
      resumedFrom: null,
      clock: () => "2026-07-28T14:32:07.000Z",
    });

    expect(existsSync(handle.path)).toBe(true);
    expect(lines(handle.path)).toEqual([
      {
        type: "session",
        startedAt: "2026-07-28T14:32:07.000Z",
        adventure: "cave",
        source: "dev",
        provider: {
          kind: "openai-compatible",
          baseURL: "http://localhost:11434/v1",
          model: "llama3.1",
        },
        saveSlot: "autosave",
        resumedFrom: null,
      },
    ]);
  });

  it("appendTurn appends one JSON line per call", () => {
    const handle = startSessionLog({
      adventureId: "cave",
      source: "play",
      provider: { kind: "openai-compatible", model: "llama3.1" },
      saveSlot: "autosave",
      resumedFrom: "before-boss",
      clock: () => "2026-07-28T14:32:07.000Z",
    });
    handle.appendTurn(handle.recorder.flushTurn(1, "look"));
    handle.appendTurn(handle.recorder.flushTurn(2, "go north"));

    const all = lines(handle.path);
    expect(all).toHaveLength(3); // header + 2 turns
    expect(all[1]).toMatchObject({ type: "turn", turn: 1, input: "look" });
    expect(all[2]).toMatchObject({ type: "turn", turn: 2, input: "go north" });
  });

  it("sanitizes the clock timestamp into a filesystem-safe session id", () => {
    const handle = startSessionLog({
      adventureId: "cave",
      source: "dev",
      provider: { kind: "openai-compatible", model: "llama3.1" },
      saveSlot: "autosave",
      resumedFrom: null,
      clock: () => "2026-07-28T14:32:07.123Z",
    });
    expect(handle.path.endsWith("2026-07-28T14-32-07-123Z.jsonl")).toBe(true);
  });

  it("defaults to the real clock when none is injected", () => {
    const handle = startSessionLog({
      adventureId: "cave",
      source: "dev",
      provider: { kind: "openai-compatible", model: "llama3.1" },
      saveSlot: "autosave",
      resumedFrom: null,
    });
    expect(existsSync(handle.path)).toBe(true);
  });
});
