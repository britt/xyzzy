import { afterEach, describe, expect, it } from "vitest";
import { FakeNarratorModel } from "./NarratorModel.js";
import { FakeDetector } from "./Detector.js";
import { SessionRecorder, sessionLogPath } from "./sessionLog.js";

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
