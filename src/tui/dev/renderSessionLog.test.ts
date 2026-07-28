import { describe, expect, it } from "vitest";
import { renderSessionLogFields } from "./renderSessionLog.js";
import type { SessionLogRecord } from "../../llm/sessionLog.js";

const header: SessionLogRecord = {
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
};

describe("renderSessionLogFields", () => {
  it("renders the session header as a heading + scalar rows", () => {
    const rows = renderSessionLogFields([header]);
    expect(rows[0]).toMatchObject({
      kind: "heading",
      title: "2026-07-28T14:32:07.000Z",
    });
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "scalar", label: "Source", value: "dev" }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "scalar", label: "Save slot", value: "autosave" }),
    );
  });

  it("names the slot a session resumed from, when it resumed one", () => {
    const resumed: SessionLogRecord = { ...header, resumedFrom: "before-boss" };
    expect(renderSessionLogFields([resumed])).toContainEqual(
      expect.objectContaining({
        kind: "scalar",
        label: "Resumed from",
        value: "before-boss",
        dim: false,
      }),
    );
  });

  it("renders a successful narrator call with its context and narration", () => {
    const turn: SessionLogRecord = {
      type: "turn",
      turn: 1,
      input: "look",
      detector: [],
      narrator: [
        {
          context: { systemPrompt: "sp", digest: "d", transcript: [], input: "look" },
          ms: 12,
          ok: true,
          result: {
            narration: "You look around.",
            actions: [{ type: "addItem", item: "key" }],
          },
        },
      ],
    };
    const rows = renderSessionLogFields([header, turn]);
    const text = JSON.stringify(rows);
    expect(text).toContain("You look around.");
    expect(text).toContain("look"); // player input surfaced
    expect(text).toContain("addItem");
  });

  it("renders a failed narrator call's error instead of a result", () => {
    const turn: SessionLogRecord = {
      type: "turn",
      turn: 2,
      input: "go north",
      detector: [],
      narrator: [
        {
          context: {
            systemPrompt: "sp",
            digest: "d",
            transcript: [],
            input: "go north",
          },
          ms: 5,
          ok: false,
          error: { name: "Error", message: "boom" },
        },
      ],
    };
    const rows = renderSessionLogFields([header, turn]);
    expect(JSON.stringify(rows)).toContain("boom");
  });

  it("renders a detector call alongside the narrator call for the same turn", () => {
    const turn: SessionLogRecord = {
      type: "turn",
      turn: 1,
      input: "go north",
      detector: [
        {
          context: {
            input: "go north",
            exits: [],
            activeBeats: [],
            characterBeats: [],
            interactions: [],
          },
          ms: 3,
          ok: true,
          result: {
            move: "north",
            advancedBeats: [],
            advancedCharacterBeats: [],
            triggeredInteractions: [],
          },
        },
      ],
      narrator: [],
    };
    const rows = renderSessionLogFields([header, turn]);
    expect(JSON.stringify(rows)).toContain("Detector");
  });

  it("renders a failed detector call's error instead of a detection", () => {
    const turn: SessionLogRecord = {
      type: "turn",
      turn: 1,
      input: "go north",
      detector: [
        {
          context: {
            input: "go north",
            exits: [],
            activeBeats: [],
            characterBeats: [],
            interactions: [],
          },
          ms: 3,
          ok: false,
          error: { name: "Error", message: "detector exploded" },
        },
      ],
      narrator: [],
    };
    const rows = renderSessionLogFields([header, turn]);
    const text = JSON.stringify(rows);
    expect(text).toContain("detector exploded");
    expect(text).toContain("failed");
  });

  it("returns [] for an empty record list", () => {
    expect(renderSessionLogFields([])).toEqual([]);
  });
});
