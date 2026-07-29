import { describe, expect, it } from "vitest";
import { renderSessionLogFields } from "./renderSessionLog.js";
import type { SessionLogRecord } from "../../llm/sessionLog.js";
import type { FieldRow } from "./renderFields.js";

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

describe("renderSessionLogFields per-turn noise", () => {
  const PROMPT = "You are the game master. Be vivid.";

  function turn(n: number, input: string, systemPrompt = PROMPT): SessionLogRecord {
    return {
      type: "turn",
      turn: n,
      input,
      detector: [],
      narrator: [
        {
          context: { systemPrompt, digest: `Location: Room ${n}`, transcript: [], input },
          ms: 7,
          ok: true,
          result: { narration: `Narration ${n}.`, actions: [] },
        },
      ],
    };
  }

  const occurrences = (rows: unknown, needle: string) =>
    JSON.stringify(rows).split(JSON.stringify(needle).slice(1, -1)).length - 1;

  it("renders the session's system prompt once, not once per turn", () => {
    const rows = renderSessionLogFields([header, turn(1, "look"), turn(2, "wait")]);
    expect(occurrences(rows, PROMPT)).toBe(1);
  });

  it("puts that single copy in the session header, above the first turn", () => {
    const rows = renderSessionLogFields([header, turn(1, "look")]);
    const promptAt = rows.findIndex(
      (r) => r.kind === "block" && r.label === "System prompt",
    );
    const turnAt = rows.findIndex((r) => r.kind === "heading" && r.title === "Turn 1");
    expect(promptAt).toBeGreaterThan(-1);
    expect(promptAt).toBeLessThan(turnAt);
  });

  it("still shows each turn's own input, narration and digest", () => {
    const text = JSON.stringify(renderSessionLogFields([header, turn(1, "look"), turn(2, "wait")]));
    expect(text).toContain("look");
    expect(text).toContain("Narration 1.");
    expect(text).toContain("wait");
    expect(text).toContain("Narration 2.");
    expect(text).toContain("Location: Room 1");
    expect(text).toContain("Location: Room 2");
  });

  it("surfaces a system prompt that changed mid-session, on the turn it changed", () => {
    const edited = "You are the game master. Be terse.";
    const rows = renderSessionLogFields([header, turn(1, "look"), turn(2, "wait", edited)]);
    expect(occurrences(rows, PROMPT)).toBe(1);
    expect(occurrences(rows, edited)).toBe(1);
    // Flagged as a change rather than silently swapped in.
    expect(JSON.stringify(rows)).toContain("System prompt (changed)");
  });

  it("omits the system prompt block entirely for a session with no turns", () => {
    const rows = renderSessionLogFields([header]);
    expect(rows.some((r) => r.kind === "block" && r.label === "System prompt")).toBe(false);
  });
});

describe("renderSessionLogFields dividers", () => {
  function turnWith(n: number, calls: number): SessionLogRecord {
    return {
      type: "turn",
      turn: n,
      input: `input-${n}`,
      detector: [
        {
          context: {
            input: `input-${n}`,
            exits: [],
            activeBeats: [],
            characterBeats: [],
            interactions: [],
          },
          ms: 1,
          ok: true,
          result: {
            move: null,
            advancedBeats: [],
            advancedCharacterBeats: [],
            triggeredInteractions: [],
          },
        },
      ],
      narrator: Array.from({ length: calls }, () => ({
        context: { systemPrompt: "sp", digest: "d", transcript: [], input: `input-${n}` },
        ms: 2,
        ok: true as const,
        result: { narration: `n-${n}`, actions: [] },
      })),
    };
  }

  const solid = (rows: FieldRow[]) =>
    rows.filter((r) => r.kind === "rule" && r.style === "solid").length;
  const dotted = (rows: FieldRow[]) =>
    rows.filter((r) => r.kind === "rule" && r.style === "dotted").length;

  it("puts a solid rule immediately before each turn", () => {
    const rows = renderSessionLogFields([header, turnWith(1, 1), turnWith(2, 1)]);
    expect(solid(rows)).toBe(2);
    for (const [i, row] of rows.entries()) {
      if (row.kind === "heading" && row.title.startsWith("Turn ")) {
        expect(rows[i - 1]).toEqual({ kind: "rule", style: "solid" });
      }
    }
  });

  it("separates the exchanges within a turn with dotted rules", () => {
    // input | detector call | narrator call -> two dotted rules between three.
    const rows = renderSessionLogFields([header, turnWith(1, 1)]);
    expect(dotted(rows)).toBe(2);
  });

  it("adds a dotted rule for each extra narrator call in the same turn", () => {
    const rows = renderSessionLogFields([header, turnWith(1, 3)]);
    expect(dotted(rows)).toBe(4); // input|detector, detector|n1, n1|n2, n2|n3
  });

  it("uses no dotted rule when a turn has a single exchange", () => {
    const bare: SessionLogRecord = {
      type: "turn",
      turn: 1,
      input: "look",
      detector: [],
      narrator: [],
    };
    expect(dotted(renderSessionLogFields([header, bare]))).toBe(0);
  });

  it("emits no rules at all for a header-only log", () => {
    const rows = renderSessionLogFields([header]);
    expect(solid(rows) + dotted(rows)).toBe(0);
  });
});
