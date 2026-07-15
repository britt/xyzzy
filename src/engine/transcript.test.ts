import { describe, expect, it } from "vitest";
import { appendMessage, windowTranscript } from "./transcript.js";
import type { Message } from "../world/schema.js";

const msg = (turn: number): Message => ({
  role: "player",
  text: `t${turn}`,
  turn,
});

describe("appendMessage", () => {
  it("returns a new array with the message appended", () => {
    const start: Message[] = [msg(1)];
    const next = appendMessage(start, msg(2));
    expect(next).toHaveLength(2);
    expect(start).toHaveLength(1); // unchanged
  });
});

describe("windowTranscript", () => {
  const all = [msg(1), msg(2), msg(3), msg(4)];

  it("returns the most recent N messages", () => {
    expect(windowTranscript(all, 2).map((m) => m.turn)).toEqual([3, 4]);
  });

  it("returns everything when N exceeds length", () => {
    expect(windowTranscript(all, 10)).toHaveLength(4);
  });

  it("returns empty for a non-positive window", () => {
    expect(windowTranscript(all, 0)).toEqual([]);
  });
});
